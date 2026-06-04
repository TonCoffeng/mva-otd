// netlify/functions/otd-aanbieden.js
// POST {dossier_id} -> maakt een uniek klant-token aan, zet de status op
// 'aangeboden', en geeft het token terug. De frontend bouwt daarmee de link.
// Autorisatie: directie mag elk dossier aanbieden, een makelaar alleen het eigen.
const LEADPOOL_URL  = 'https://olfcrzusdkijxroxvsgm.supabase.co';
const LEADPOOL_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sZmNyenVzZGtpanhyb3h2c2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDEyOTQsImV4cCI6MjA5MzQ3NzI5NH0.wPygjZCIxzTTOVc2uafMtnESB0iYkxR3yF-AuiL63zc';
const OTD_URL = 'https://oonlagagxodohvakwfat.supabase.co';
const OTD_SERVICE_KEY = process.env.OTD_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const crypto = require('crypto');
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

    // dossier ophalen
    const dRes = await fetch(OTD_URL+'/rest/v1/otd_dossiers?select=id,makelaar_id,status,klant_token,object_adres&id=eq.'+encodeURIComponent(dossierId)+'&limit=1',{headers:otdH});
    const dArr = dRes.ok ? await dRes.json() : [];
    const d = dArr[0];
    if(!d) return json(404,{error:'Opdracht niet gevonden.'});

    // autorisatie
    if(!isDirectie){
      const mRes = await fetch(OTD_URL+'/rest/v1/otd_makelaars?select=id&email=eq.'+encodeURIComponent(email),{headers:otdH});
      const mArr = mRes.ok ? await mRes.json() : [];
      const eigenId = mArr[0] ? mArr[0].id : null;
      if(!eigenId || d.makelaar_id !== eigenId) return json(403,{error:'Geen toegang tot deze opdracht.'});
    }

    // token (hergebruik bestaand, anders nieuw)
    const token = d.klant_token || crypto.randomUUID().replace(/-/g,'');
    const patch = { status:'aangeboden', aangeboden_op: new Date().toISOString(), klant_token: token };
    const pRes = await fetch(OTD_URL+'/rest/v1/otd_dossiers?id=eq.'+encodeURIComponent(dossierId),{method:'PATCH',headers:Object.assign({},otdH,{'Content-Type':'application/json',Prefer:'return=minimal'}),body:JSON.stringify(patch)});
    if(!pRes.ok){ const t=await pRes.text(); return json(500,{error:'Aanbieden faalde ('+pRes.status+'): '+t}); }

    // klant-link opbouwen
    const host = event.headers.host || 'otd-mva.netlify.app';
    const link = 'https://' + host + '/klant.html?t=' + token;

    // e-mail naar de opdrachtgever (alleen als sleutel + adres aanwezig)
    let mailed = false, mailTo = null;
    if(RESEND_API_KEY){
      const ogRes = await fetch(OTD_URL+'/rest/v1/otd_opdrachtgevers?select=voornamen,achternaam,email&dossier_id=eq.'+d.id+'&order=volgorde.asc&limit=1',{headers:otdH});
      const ogArr = ogRes.ok ? await ogRes.json() : [];
      const og = ogArr[0];
      let mak = null;
      if(d.makelaar_id){
        const mRes = await fetch(OTD_URL+'/rest/v1/otd_makelaars?select=naam,entiteit_naam,email&id=eq.'+d.makelaar_id,{headers:otdH});
        const mArr = mRes.ok ? await mRes.json() : [];
        mak = mArr[0] || null;
      }
      if(og && og.email){
        mailTo = og.email;
        const aanhef = og.voornamen ? ('Beste ' + og.voornamen) : 'Beste heer/mevrouw';
        const obj = d.object_adres || 'uw woning';
        const makNaam = (mak && (mak.naam || mak.entiteit_naam)) || 'uw makelaar';
        const html =
          '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#1f2a40">' +
          '<div style="background:#1b2a4a;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0"><strong style="font-size:15px;letter-spacing:.5px">MAKELAARSVAN AMSTERDAM</strong></div>' +
          '<div style="border:1px solid #e6e9f0;border-top:none;border-radius:0 0 12px 12px;padding:24px 22px">' +
          '<p>' + aanhef + ',</p>' +
          '<p>Voor <strong>' + obj + '</strong> hebben wij de opdracht tot dienstverlening voor u klaargezet. U kunt deze rustig doorlezen en daarna online uw akkoord geven of een opmerking plaatsen.</p>' +
          '<p style="text-align:center;margin:26px 0"><a href="' + link + '" style="background:#ea580c;color:#fff;text-decoration:none;padding:13px 26px;border-radius:9px;font-weight:bold;display:inline-block">Opdracht bekijken</a></p>' +
          '<p style="font-size:13px;color:#64748b">Werkt de knop niet? Kopieer dan deze link in uw browser:<br>' + link + '</p>' +
          '<p>Met vriendelijke groet,<br>' + makNaam + '</p>' +
          '</div></div>';
        const payload = {
          from: 'MakelaarsVan Amsterdam <noreply@makelaarsvan.nl>',
          to: [og.email],
          subject: 'Uw opdracht tot dienstverlening — ' + obj,
          html: html
        };
        if(mak && mak.email) payload.reply_to = mak.email;
        try{
          const sendRes = await fetch('https://api.resend.com/emails',{
            method:'POST',
            headers:{ Authorization:'Bearer '+RESEND_API_KEY, 'Content-Type':'application/json' },
            body: JSON.stringify(payload)
          });
          mailed = sendRes.ok;
        }catch(e){ mailed = false; }
      }
    }

    return json(200,{ ok:true, token, link, mailed, mail_to:mailTo });
  } catch(e){ return json(500,{error:String((e&&e.message)||e)}); }
};
