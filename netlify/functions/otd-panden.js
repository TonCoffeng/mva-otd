// netlify/functions/otd-panden.js
// Haalt het actuele woningaanbod (panden, Realworks-sync) uit het Leadpool-project
// op voor de objectkeuze in de OTD-bouwer. Directie ziet alles, een makelaar
// alleen zijn eigen panden (op accountmanager_email).
const { createClient } = require('@supabase/supabase-js');

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

    const leadpool = createClient(LEADPOOL_URL, LEADPOOL_ANON, {
      global: { headers: { Authorization: 'Bearer ' + jwt } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: u, error: uErr } = await leadpool.auth.getUser(jwt);
    if (uErr || !u || !u.user) return json(401, { error: 'Ongeldige of verlopen sessie.' });
    const email = u.user.email;
    const { data: gebr } = await leadpool
      .from('gebruikers').select('rol').eq('email', email).maybeSingle();
    const isDirectie = (gebr && gebr.rol === 'directie');

    let q = leadpool.from('panden')
      .select('realworks_object_id,adres,postcode,plaats,status,accountmanager_email')
      .order('adres', { ascending: true });
    if (!isDirectie) q = q.eq('accountmanager_email', email);

    const { data, error } = await q;
    if (error) return json(500, { error: error.message });
    return json(200, { panden: data || [] });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
