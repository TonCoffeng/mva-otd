// netlify/functions/otd-dossiers.js
// Brug tussen Leadpool-identiteit en de OTD-database.
// Gebruikt directe REST-fetch (geen supabase-js) → geen WebSocket-afhankelijkheid,
// werkt op elke Node-versie.
const LEADPOOL_URL  = 'https://olfcrzusdkijxroxvsgm.supabase.co';
const LEADPOOL_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sZmNyenVzZGtpanhyb3h2c2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDEyOTQsImV4cCI6MjA5MzQ3NzI5NH0.wPygjZCIxzTTOVc2uafMtnESB0iYkxR3yF-AuiL63zc';
const OTD_URL = 'https://oonlagagxodohvakwfat.supabase.co';
const OTD_SERVICE_KEY = process.env.OTD_SERVICE_KEY;

const json = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

exports.handler = async (event) => {
  try {
    if (!OTD_SERVICE_KEY) return json(500, { error: 'Serverconfig ontbreekt (OTD_SERVICE_KEY).' });

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json(401, { error: 'Niet ingelogd.' });

    // 1) Sessie valideren bij Leadpool (GoTrue)
    const uRes = await fetch(LEADPOOL_URL + '/auth/v1/user', {
      headers: { apikey: LEADPOOL_ANON, Authorization: 'Bearer ' + jwt }
    });
    if (!uRes.ok) return json(401, { error: 'Ongeldige of verlopen sessie.' });
    const user = await uRes.json();
    const email = user && user.email;
    if (!email) return json(401, { error: 'Geen e-mail in sessie.' });

    // 2) Rol uit gebruikers (JWT → RLS)
    const gRes = await fetch(LEADPOOL_URL + '/rest/v1/gebruikers?select=rol,naam&email=eq.' + encodeURIComponent(email), {
      headers: { apikey: LEADPOOL_ANON, Authorization: 'Bearer ' + jwt }
    });
    const gArr = gRes.ok ? await gRes.json() : [];
    const gebr = gArr[0] || {};
    const rol = gebr.rol || 'onbekend';
    const naam = gebr.naam || email;
    const isDirectie = (rol === 'directie');

    // 3) OTD-database via service-sleutel
    const otdH = { apikey: OTD_SERVICE_KEY, Authorization: 'Bearer ' + OTD_SERVICE_KEY };

    // Eigen makelaar (koppeling op e-mail)
    const mRes = await fetch(OTD_URL + '/rest/v1/otd_makelaars?select=id&email=eq.' + encodeURIComponent(email), { headers: otdH });
    const mArr = mRes.ok ? await mRes.json() : [];
    const makelaarId = mArr[0] ? mArr[0].id : null;

    if (event.httpMethod === 'GET') {
      let path = '/rest/v1/otd_dossiers?select=id,documenttype,object_adres,object_plaats,vraagprijs,courtage_type,courtage_pct_incl,courtage_vast_bedrag,datum_opdracht,status,makelaar_id&order=aangemaakt_op.desc';
      if (!isDirectie) {
        if (!makelaarId) return json(200, { rol, naam, dossiers: [] });
        path += '&makelaar_id=eq.' + makelaarId;
      }
      const dRes = await fetch(OTD_URL + path, { headers: otdH });
      if (!dRes.ok) return json(500, { error: 'OTD-query faalde (' + dRes.status + ').' });
      const dossiers = await dRes.json();

      const ogMap = {};
      const ids = dossiers.map(d => d.id);
      if (ids.length) {
        const inList = ids.map(i => '"' + i + '"').join(',');
        const ogRes = await fetch(OTD_URL + '/rest/v1/otd_opdrachtgevers?select=dossier_id,voornamen,tussenvoegsels,achternaam,volgorde&dossier_id=in.(' + inList + ')', { headers: otdH });
        const ogs = ogRes.ok ? await ogRes.json() : [];
        ogs.forEach(o => { if (!ogMap[o.dossier_id] || o.volgorde < ogMap[o.dossier_id].volgorde) ogMap[o.dossier_id] = o; });
      }
      const rijen = dossiers.map(d => {
        const o = ogMap[d.id];
        const naamOg = o ? [o.voornamen, o.tussenvoegsels, o.achternaam].filter(Boolean).join(' ') : null;
        return Object.assign({}, d, { opdrachtgever: naamOg });
      });
      return json(200, { rol, naam, makelaarId, dossiers: rijen });
    }

    return json(405, { error: 'Methode niet toegestaan.' });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
