// netlify/functions/otd-producten.js
// Levert de productcatalogus voor het Woningpromotieplan (stap 3 van de bouwer).
//
// Response:
//   { producten: [ ...alle actieve producten... ],
//     geleerd:   [ product_id, ... ]  // meest gekozen eerst, voor deze makelaar }
//
// "geleerd" wordt afgeleid uit de historie in otd_regels (automatisch leren).
// Zolang een makelaar nog geen historie heeft is deze lijst leeg en valt de
// frontend terug op de snelkeuze-set (Tier 1 KERN).
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

    // Sessie valideren bij Leadpool (GoTrue)
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json(401, { error: 'Niet ingelogd.' });
    const uRes = await fetch(LEADPOOL_URL + '/auth/v1/user', {
      headers: { apikey: LEADPOOL_ANON, Authorization: 'Bearer ' + jwt }
    });
    if (!uRes.ok) return json(401, { error: 'Ongeldige of verlopen sessie.' });

    const oh = { apikey: OTD_SERVICE_KEY, Authorization: 'Bearer ' + OTD_SERVICE_KEY };

    // 1) Volledige actieve catalogus
    const sel = 'id,naam,commerciele_naam,prijs_incl_btw,prijs_ex_btw,btw_tarief,'
              + 'categorie,is_pakket,snelkeuze,prijs_aanpasbaar,betaalwijze,afdracht';
    const pRes = await fetch(
      OTD_URL + '/rest/v1/otd_producten?select=' + sel +
      '&actief=eq.true&order=categorie.asc,is_pakket.desc,prijs_incl_btw.desc.nullslast',
      { headers: oh }
    );
    if (!pRes.ok) return json(500, { error: 'Producten-query faalde (' + pRes.status + ').' });
    const producten = await pRes.json();

    // 2) Geleerde volgorde voor deze makelaar (optioneel)
    let geleerd = [];
    const makelaar = (event.queryStringParameters && event.queryStringParameters.makelaar) || '';
    if (makelaar) {
      try {
        const rRes = await fetch(
          OTD_URL + '/rest/v1/otd_regels?select=product_id,otd_dossiers!inner(makelaar_id)' +
          '&otd_dossiers.makelaar_id=eq.' + encodeURIComponent(makelaar) +
          '&product_id=not.is.null',
          { headers: oh }
        );
        if (rRes.ok) {
          const regels = await rRes.json();
          const tel = {};
          for (const r of regels) {
            if (r && r.product_id) tel[r.product_id] = (tel[r.product_id] || 0) + 1;
          }
          geleerd = Object.keys(tel).sort((a, b) => tel[b] - tel[a]);
        }
      } catch (_) { /* val stil terug op de KERN-set */ }
    }

    return json(200, { producten, geleerd });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
