// netlify/functions/otd-aanbieden.js
// POST {dossier_id} -> maakt een uniek klant-token aan, zet de status op
// 'aangeboden', en geeft het token terug. De frontend bouwt daarmee de link.
// Autorisatie: directie mag elk dossier aanbieden, een makelaar alleen het eigen.
const LEADPOOL_URL  = 'https://olfcrzusdkijxroxvsgm.supabase.co';
const LEADPOOL_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sZmNyenVzZGtpanhyb3h2c2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDEyOTQsImV4cCI6MjA5MzQ3NzI5NH0.wPygjZCIxzTTOVc2uafMtnESB0iYkxR3yF-AuiL63zc';
const OTD_URL = 'https://oonlagagxodohvakwfat.supabase.co';
const OTD_SERVICE_KEY = process.env.OTD_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY_OTD || process.env.RESEND_API_KEY;
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
    // directie én compliance (virtueel assistent makelaars) hebben volledige OTD-toegang
    const isDirectie = (gArr[0] && (gArr[0].rol === 'directie' || gArr[0].rol === 'compliance'));

    const otdH = { apikey:OTD_SERVICE_KEY, Authorization:'Bearer '+OTD_SERVICE_KEY };
    const body = JSON.parse(event.body||'{}');
    const dossierId = body.dossier_id;
    if(!dossierId) return json(400,{error:'Geen dossier opgegeven.'});

    // dossier ophalen
    const dRes = await fetch(OTD_URL+'/rest/v1/otd_dossiers?select=id,makelaar_id,status,klant_token,object_adres,taal,documenttype&id=eq.'+encodeURIComponent(dossierId)+'&limit=1',{headers:otdH});
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
    const link = 'https://' + host + '/klant?t=' + token;

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
        const eng = (d.taal === 'nl_en'); // knop NL+EN = klantcommunicatie in het Engels
        const aanhef = eng
          ? ('Dear ' + (og.voornamen || 'Sir/Madam'))
          : ('Beste ' + (og.voornamen || 'heer/mevrouw'));
        const isAankoop = (d.documenttype === 'aankoop');
        const obj = d.object_adres || (isAankoop ? (eng ? 'your purchase engagement' : 'uw aankoopopdracht') : (eng ? 'your home' : 'uw woning'));
        const onderwerpDeel = isAankoop ? (d.object_adres || (eng ? 'purchase support' : 'aankoopbegeleiding')) : obj;
        const introTekst = eng
          ? (isAankoop
              ? ('Thank you for the pleasant conversation about ' + (d.object_adres ? ('the purchase of <strong>' + d.object_adres + '</strong>') : 'your home search') + '. As discussed, we have prepared the service agreement (opdracht tot dienstverlening) for you, setting out exactly what we will do for you and which terms apply. Please take your time to read it &mdash; the agreement only becomes final once you have signed. You can place a question or comment directly online.')
              : ('Thank you for the pleasant conversation about the sale of <strong>' + obj + '</strong>. As discussed, we have prepared the service agreement (opdracht tot dienstverlening) for you, setting out exactly what we will do for you and which terms apply. Please take your time to read it &mdash; the agreement only becomes final once you have signed. You can place a question or comment directly online.'))
          : (isAankoop
              ? ('Dank voor het goede gesprek over ' + (d.object_adres ? ('de aankoop van <strong>' + d.object_adres + '</strong>') : 'uw woningzoektocht') + '. Zoals besproken hebben wij de opdracht tot dienstverlening voor u klaargezet, met daarin precies wat wij voor u gaan doen en welke afspraken daarbij horen. Leest u alles rustig door &mdash; pas met uw handtekening is de opdracht definitief. Een vraag of opmerking plaatsen kan direct online.')
              : ('Dank voor het goede gesprek over de verkoop van <strong>' + obj + '</strong>. Zoals besproken hebben wij de opdracht tot dienstverlening voor u klaargezet, met daarin precies wat wij voor u gaan doen en welke afspraken daarbij horen. Leest u alles rustig door &mdash; pas met uw handtekening is de opdracht definitief. Een vraag of opmerking plaatsen kan direct online.'));
        const makNaam = (mak && (mak.naam || mak.entiteit_naam)) || (eng ? 'your agent' : 'uw makelaar');
        const makEmail = (mak && mak.email) || 'amsterdam@makelaarsvan.nl';
        const tweetalig = eng;
        const tipsLink = 'https://' + host + (isAankoop ? '/na-ondertekening-aankoop.html' : '/na-ondertekening.html');
        const docsBase = 'https://' + host + '/docs/';
        const T = eng ? {
          knop: 'View &amp; sign the agreement',
          fallback: 'Button not working? <a href="' + link + '" style="color:#df5a0f">Open the agreement via this link</a>.',
          wwftKop: 'Identification (Wwft)',
          wwft: 'As real estate agents we are legally required to verify the identity of our clients. At the start of our engagement we will ask you to identify yourself with a valid ID document &mdash; we will let you know how and when this is most convenient.',
          tips: 'Curious what happens after signing? <a href="' + tipsLink + '" style="color:#df5a0f;font-weight:bold">Read what to expect &rsaquo;</a>',
          voorwaarden: 'The general terms and conditions applicable to this agreement are attached to this e-mail.',
          groet: 'Kind regards,'
        } : {
          knop: 'Opdracht bekijken &amp; ondertekenen',
          fallback: 'Werkt de knop niet? <a href="' + link + '" style="color:#df5a0f">Open de opdracht via deze link</a>.',
          wwftKop: 'Identificatie (Wwft)',
          wwft: 'Als makelaar zijn wij wettelijk verplicht onze opdrachtgevers te identificeren. Bij de start vragen wij u zich te legitimeren met een geldig identiteitsbewijs &mdash; wij laten u weten hoe en wanneer dit het makkelijkst kan.',
          tips: 'Benieuwd wat er na ondertekening gebeurt? <a href="' + tipsLink + '" style="color:#df5a0f;font-weight:bold">Lees hier wat er op u afkomt &rsaquo;</a>',
          voorwaarden: 'De algemene voorwaarden die bij deze opdracht horen, vindt u als bijlage bij deze e-mail.',
          groet: 'Met vriendelijke groet,'
        };
        const html =
          '<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:auto;color:#27313f;line-height:1.55">' +
            '<div style="background:#16243f;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;border-bottom:3px solid #df5a0f">' +
              '<strong style="font-size:15px;letter-spacing:1px">MAKELAARSVAN AMSTERDAM</strong></div>' +
            '<div style="border:1px solid #e9e3d8;border-top:none;border-radius:0 0 12px 12px;padding:26px 24px;background:#fffdfa">' +
              '<p style="margin:0 0 14px">' + aanhef + ',</p>' +
              '<p style="margin:0 0 14px">' + introTekst + '</p>' +
              '<p style="text-align:center;margin:26px 0"><a href="' + link + '" style="background:#df5a0f;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:bold;display:inline-block">' + T.knop + '</a></p>' +
              '<p style="font-size:13px;color:#6c7689;margin:0 0 22px">' + T.fallback + '</p>' +
              '<div style="background:#fdf1e8;border-left:3px solid #df5a0f;border-radius:0 8px 8px 0;padding:13px 16px;margin:0 0 18px">' +
                '<strong style="color:#df5a0f">' + T.wwftKop + '</strong><br>' + T.wwft +
              '</div>' +
              '<p style="margin:0 0 14px">' + T.tips + '</p>' +
              '<p style="margin:0 0 18px">' + T.voorwaarden + '</p>' +
              '<p style="margin:0">' + T.groet + '<br><strong>' + makNaam + '</strong><br>' +
                '<span style="color:#6c7689;font-size:13px">' + makEmail + ' &middot; +31 (0)20 333 11 10</span></p>' +
            '</div>' +
            '<div style="text-align:center;color:#9aa3b3;font-size:11px;padding:14px">MakelaarsVan Amsterdam &middot; Valkenburgerstraat 67, 1011 MG Amsterdam</div>' +
          '</div>';
        const attachments = [
          { filename: 'Algemene-Consumentenvoorwaarden-Makelaardij.pdf', path: docsBase + 'vbo-algemene-consumenten-voorwaarden-juli-2023-19534.pdf' }
        ];
        if(!isAankoop){
          attachments.push({ filename: 'Uw-eigen-unieke-woningwebsite.pdf', path: docsBase + 'Uw_eigen_unieke_woning_website.pdf' });
        }
        if(tweetalig){
          attachments.push({ filename: 'General-Terms-and-Conditions-for-Consumers.pdf', path: docsBase + 'General_terms_and_conditions_and_regulations_for_consumers.pdf' });
        }
        const payload = {
          from: 'MakelaarsVan Amsterdam <noreply@makelaarsvan.nl>',
          to: [og.email],
          subject: (eng ? 'Your service agreement — ' : 'Uw opdracht tot dienstverlening — ') + onderwerpDeel,
          html: html,
          attachments: attachments
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
