// netlify/functions/otd-relaties.js
// Zoekt relaties in Cloze (de permanente CRM) voor de opdrachtgever-keuze.
// Filtert op eigenaar: directie ziet alles, een makelaar alleen zijn eigen
// relaties (assignedTo == eigen e-mail) plus relaties zonder eigenaar.
const LEADPOOL_URL  = 'https://olfcrzusdkijxroxvsgm.supabase.co';
const LEADPOOL_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sZmNyenVzZGtpanhyb3h2c2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDEyOTQsImV4cCI6MjA5MzQ3NzI5NH0.wPygjZCIxzTTOVc2uafMtnESB0iYkxR3yF-AuiL63zc';
const CLOZE_API_KEY = process.env.CLOZE_API_KEY;

const json = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

function eigenaarVan(p) {
  const a = p.assignedTo;
  let e = null;
  if (typeof a === 'string') e = a;
  else if (a && typeof a === 'object') e = a.email || a.value || null;
  if (!e && p.owner) e = (typeof p.owner === 'string') ? p.owner : (p.owner.email || null);
  return e;
}

exports.handler = async (event) => {
  try {
    if (!CLOZE_API_KEY) return json(500, { error: 'Serverconfig ontbreekt (CLOZE_API_KEY).' });

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json(401, { error: 'Niet ingelogd.' });

    const uRes = await fetch(LEADPOOL_URL + '/auth/v1/user', {
      headers: { apikey: LEADPOOL_ANON, Authorization: 'Bearer ' + jwt }
    });
    if (!uRes.ok) return json(401, { error: 'Ongeldige of verlopen sessie.' });
    const user = await uRes.json();
    const email = (user && user.email) ? user.email : null;
    if (!email) return json(401, { error: 'Geen e-mail in sessie.' });

    const gRes = await fetch(LEADPOOL_URL + '/rest/v1/gebruikers?select=rol&email=eq.' + encodeURIComponent(email), {
      headers: { apikey: LEADPOOL_ANON, Authorization: 'Bearer ' + jwt }
    });
    const gArr = gRes.ok ? await gRes.json() : [];
    // directie én compliance (virtueel assistent makelaars) hebben volledige OTD-toegang
    const isDirectie = (gArr[0] && (gArr[0].rol === 'directie' || gArr[0].rol === 'compliance'));

    const q = ((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
    if (q.length < 2) return json(200, { relaties: [] });

    // Cloze zoeken
    const cRes = await fetch('https://api.cloze.com/v1/people/find?api_key=' + encodeURIComponent(CLOZE_API_KEY) + '&freeformquery=' + encodeURIComponent(q) + '&pagesize=15');
    if (!cRes.ok) return json(502, { error: 'Cloze niet bereikbaar (' + cRes.status + ').' });
    const cJson = await cRes.json();
    const people = (cJson && cJson.people) || [];

    const mineEmail = email.toLowerCase();
    const relaties = people.map(p => {
      const eig = eigenaarVan(p);
      return {
        cloze_id: p.id || p.uniqueid || null,
        naam: p.name || '',
        email: (p.emails && p.emails[0] && (p.emails[0].value || p.emails[0])) || '',
        telefoon: (p.phones && p.phones[0] && (p.phones[0].value || p.phones[0])) || '',
        stage: p.stage || null,
        eigenaar: eig
      };
    }).filter(r => {
      if (isDirectie) return true;
      if (!r.eigenaar) return true;                       // zonder eigenaar = vrij
      return r.eigenaar.toLowerCase() === mineEmail;      // eigen relatie
    });

    return json(200, { relaties, rol: isDirectie ? 'directie' : 'makelaar' });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
