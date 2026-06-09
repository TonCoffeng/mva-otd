// netlify/functions/otd-archiveren.js
// POST { dossier_id, gearchiveerd:true|false } -> (de)archiveert een dossier.
// Autorisatie: directie elk dossier, een makelaar alleen het eigen.
const LEADPOOL_URL  = 'https://olfcrzusdkijxroxvsgm.supabase.co';
const LEADPOOL_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sZmNyenVzZGtpanhyb3h2c2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDEyOTQsImV4cCI6MjA5MzQ3NzI5NH0.wPygjZCIxzTTOVc2uafMtnESB0iYkxR3yF-AuiL63zc';
const OTD_URL = 'https://oonlagagxodohvakwfat.supabase.co';
const OTD_SERVICE_KEY = process.env.OTD_SERVICE_KEY;
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  try {
    if(!OTD_SERVICE_KEY) return json(500,{error:'Serverconfig ontbreekt (OTD_SERVICE_KEY).'});
    if(event.httpMethod !== 'POST') return json(405,{error:'Methode niet toegestaan.'});

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const jwt = authHeader.replace(/^Bearer\s+/i,'').trim();
    if(!jwt) return json(401,{error:'Niet ingelogd.'});

    const uRes = await fetch(LEADPOOL_URL+'/auth/v1/user',{headers:{apikey:LEADPOOL_ANON,Authorization:'Bearer '+jwt}});
    if(!uRes.ok) return json(401,{error:'Ongeldige of verlopen sessie.'});
    const user = await uRes.json();
    const email = (user && user.email) ? user.email : null;
    if(!email) return json(401,{error:'Geen e-mail in sessie.'});

    const gRes = await fetch(LEADPOOL_URL+'/rest/v1/gebruikers?select=rol&email=eq.'+encodeURIComponent(email),{headers:{apikey:LEADPOOL_ANON,Authorization:'Bearer '+jwt}});
    const gArr = gRes.ok ? await gRes.json() : [];
    const isDirectie = (gArr[0] && gArr[0].rol === 'directie');

    const otdH = { apikey:OTD_SERVICE_KEY, Authorization:'Bearer '+OTD_SERVICE_KEY };
    const body = JSON.parse(event.body||'{}');
    const dossierId = body.dossier_id;
    if(!dossierId) return json(400,{error:'Geen dossier opgegeven.'});
    const archief = body.gearchiveerd === true || body.gearchiveerd === 'true';

    const dRes = await fetch(OTD_URL+'/rest/v1/otd_dossiers?select=id,makelaar_id&id=eq.'+encodeURIComponent(dossierId)+'&limit=1',{headers:otdH});
    const dArr = dRes.ok ? await dRes.json() : [];
    const d = dArr[0];
    if(!d) return json(404,{error:'Opdracht niet gevonden.'});

    if(!isDirectie){
      const mRes = await fetch(OTD_URL+'/rest/v1/otd_makelaars?select=id&email=eq.'+encodeURIComponent(email),{headers:otdH});
      const mArr = mRes.ok ? await mRes.json() : [];
      const eigenId = mArr[0] ? mArr[0].id : null;
      if(!eigenId || d.makelaar_id !== eigenId) return json(403,{error:'Geen toegang tot deze opdracht.'});
    }

    const patch = { gearchiveerd: archief, gearchiveerd_op: archief ? new Date().toISOString() : null };
    const pRes = await fetch(OTD_URL+'/rest/v1/otd_dossiers?id=eq.'+encodeURIComponent(dossierId),{method:'PATCH',headers:Object.assign({},otdH,{'Content-Type':'application/json',Prefer:'return=minimal'}),body:JSON.stringify(patch)});
    if(!pRes.ok){ const t=await pRes.text(); return json(500,{error:'Archiveren faalde ('+pRes.status+'): '+t}); }

    return json(200,{ ok:true, gearchiveerd:archief });
  } catch(e){ return json(500,{error:String((e&&e.message)||e)}); }
};
