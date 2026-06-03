// netlify/functions/otd-dossiers.js
// Brug tussen Leadpool-identiteit en de OTD-database.
// - Valideert de meegestuurde Leadpool-sessie (JWT).
// - Bepaalt rol (directie ziet alles) en de eigen otd_makelaar.
// - Praat met de OTD-database via de service-sleutel (alleen server-side).
const { createClient } = require('@supabase/supabase-js');

// Niet-geheim (publiek bedoeld):
const LEADPOOL_URL  = 'https://olfcrzusdkijxroxvsgm.supabase.co';
const LEADPOOL_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sZmNyenVzZGtpanhyb3h2c2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDEyOTQsImV4cCI6MjA5MzQ3NzI5NH0.wPygjZCIxzTTOVc2uafMtnESB0iYkxR3yF-AuiL63zc';
const OTD_URL = 'https://oonlagagxodohvakwfat.supabase.co';
// Geheim, uit Netlify env:
const OTD_SERVICE_KEY = process.env.OTD_SERVICE_KEY;

const json = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

exports.handler = async (event) => {
  try {
    if (!OTD_SERVICE_KEY) return json(500, { error: 'Serverconfig ontbreekt (OTD_SERVICE_KEY).' });

    // 1) Sessie-token uit de Authorization-header
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json(401, { error: 'Niet ingelogd.' });

    // 2) Token valideren bij Leadpool + gebruiker/rol bepalen
    const leadpool = createClient(LEADPOOL_URL, LEADPOOL_ANON, {
      global: { headers: { Authorization: 'Bearer ' + jwt } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: u, error: uErr } = await leadpool.auth.getUser(jwt);
    if (uErr || !u || !u.user) return json(401, { error: 'Ongeldige of verlopen sessie.' });
    const email = u.user.email;
    const { data: gebr } = await leadpool
      .from('gebruikers').select('rol,naam,email').eq('email', email).maybeSingle();
    const rol = (gebr && gebr.rol) || 'onbekend';
    const naam = (gebr && gebr.naam) || email;
    const isDirectie = (rol === 'directie');

    // 3) OTD-database via service-sleutel (autorisatie hieronder in code)
    const otd = createClient(OTD_URL, OTD_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // Eigen otd_makelaar (koppeling op e-mail)
    const { data: mak } = await otd
      .from('otd_makelaars').select('id,naam').eq('email', email).maybeSingle();
    const makelaarId = mak ? mak.id : null;

    if (event.httpMethod === 'GET') {
      let q = otd.from('otd_dossiers')
        .select('id,documenttype,object_adres,object_plaats,vraagprijs,courtage_type,courtage_pct_incl,courtage_vast_bedrag,datum_opdracht,status,makelaar_id')
        .order('aangemaakt_op', { ascending: false });

      if (!isDirectie) {
        if (!makelaarId) return json(200, { rol, naam, dossiers: [] });
        q = q.eq('makelaar_id', makelaarId);
      }
      const { data: dossiers, error: dErr } = await q;
      if (dErr) return json(500, { error: dErr.message });

      // Eerste opdrachtgever per dossier erbij (geen FK-embed → robuust)
      const ids = dossiers.map(d => d.id);
      let ogMap = {};
      if (ids.length) {
        const { data: ogs } = await otd
          .from('otd_opdrachtgevers')
          .select('dossier_id,voornamen,tussenvoegsels,achternaam,volgorde')
          .in('dossier_id', ids);
        (ogs || []).forEach(o => {
          if (!ogMap[o.dossier_id] || o.volgorde < ogMap[o.dossier_id].volgorde) ogMap[o.dossier_id] = o;
        });
      }
      const rijen = dossiers.map(d => {
        const o = ogMap[d.id];
        const naamOg = o ? [o.voornamen, o.tussenvoegsels, o.achternaam].filter(Boolean).join(' ') : null;
        return { ...d, opdrachtgever: naamOg };
      });
      return json(200, { rol, naam, makelaarId, dossiers: rijen });
    }

    return json(405, { error: 'Methode niet toegestaan.' });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
