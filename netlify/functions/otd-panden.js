// netlify/functions/otd-panden.js
// Haalt het actuele woningaanbod (panden, Realworks-sync) uit Leadpool op voor
// de objectkeuze. Directe REST-fetch (geen supabase-js, geen WebSocket).
const LEADPOOL_URL  = 'https://olfcrzusdkijxroxvsgm.supabase.co';
const LEADPOOL_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sZmNyenVzZGtpanhyb3h2c2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDEyOTQsImV4cCI6MjA5MzQ3NzI5NH0.wPygjZCIxzTTOVc2uafMtnESB0iYkxR3yF-AuiL63zc';

const json = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

exports.handler = async (event) => {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json(401, { error: 'Niet ingelogd.' });

    const uRes = await fetch(LEADPOOL_URL + '/auth/v1/user', {
      headers: { apikey: LEADPOOL_ANON, Authorization: 'Bearer ' + jwt }
    });
    if (!uRes.ok) return json(401, { error: 'Ongeldige of verlopen sessie.' });
    const user = await uRes.json();
    const email = user && user.email;
    if (!email) return json(401, { error: 'Geen e-mail in sessie.' });

    const gRes = await fetch(LEADPOOL_URL + '/rest/v1/gebruikers?select=rol&email=eq.' + encodeURIComponent(email), {
      headers: { apikey: LEADPOOL_ANON, Authorization: 'Bearer ' + jwt }
    });
    const gArr = gRes.ok ? await gRes.json() : [];
    // directie én compliance (virtueel assistent makelaars) hebben volledige OTD-toegang
    const isDirectie = (gArr[0] && (gArr[0].rol === 'directie' || gArr[0].rol === 'compliance'));

    let path = '/rest/v1/panden?select=realworks_object_id,adres,postcode,plaats,status,accountmanager_email&order=adres.asc';
    if (!isDirectie) path += '&accountmanager_email=eq.' + encodeURIComponent(email);

    const pRes = await fetch(LEADPOOL_URL + path, {
      headers: { apikey: LEADPOOL_ANON, Authorization: 'Bearer ' + jwt }
    });
    if (!pRes.ok) return json(500, { error: 'Panden-query faalde (' + pRes.status + ').' });
    const panden = await pRes.json();
    return json(200, { panden });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
