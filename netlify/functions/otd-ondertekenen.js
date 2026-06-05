// netlify/functions/otd-ondertekenen.js
// POST ?t=TOKEN  (publiek, token = sleutel — net als otd-klant/otd-pdf)
// Maakt een Signhost-ondertekentransactie aan voor de opdrachtgever:
//  1) haalt de OTD-PDF op (via otd-pdf), 2) maakt transactie, 3) upload PDF,
//  4) start transactie, 5) geeft de SignUrl terug zodat de klant direct kan tekenen.
const OTD_URL = 'https://oonlagagxodohvakwfat.supabase.co';
const OTD_SERVICE_KEY = process.env.OTD_SERVICE_KEY;
const SIGNHOST_API_KEY = (process.env.SIGNHOST_API_KEY || '').trim();
const SIGNHOST_APP_KEY = (process.env.SIGNHOST_APP_KEY || '').trim();
const SIGNHOST_BASE = 'https://api.signhost.com/api';
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  try {
    if(!OTD_SERVICE_KEY) return json(500,{error:'Serverconfig ontbreekt (OTD_SERVICE_KEY).'});
    if(!SIGNHOST_API_KEY || !SIGNHOST_APP_KEY) return json(500,{error:'Signhost-sleutels ontbreken.'});
    if(event.httpMethod !== 'POST') return json(405,{error:'Methode niet toegestaan.'});

    const token = ((event.queryStringParameters && event.queryStringParameters.t)||'').trim();
    if(!token) return json(400,{error:'Geen geldige link.'});
    const otdH = { apikey:OTD_SERVICE_KEY, Authorization:'Bearer '+OTD_SERVICE_KEY };
    const shH = { Authorization:'APIKey '+SIGNHOST_API_KEY, Application:'APPKey '+SIGNHOST_APP_KEY };

    // 1. dossier ophalen
    const dRes = await fetch(OTD_URL+'/rest/v1/otd_dossiers?select=id,status,object_adres,klant_token,signhost_transaction_id&klant_token=eq.'+encodeURIComponent(token)+'&limit=1',{headers:otdH});
    const dArr = dRes.ok ? await dRes.json() : [];
    const d = dArr[0];
    if(!d) return json(404,{error:'Deze link is niet (meer) geldig.'});
    if(d.status === 'ondertekend') return json(409,{error:'Deze opdracht is al ondertekend.'});

    // opdrachtgever (eerste ondertekenaar)
    const ogRes = await fetch(OTD_URL+'/rest/v1/otd_opdrachtgevers?select=voornamen,tussenvoegsels,achternaam,email&dossier_id=eq.'+d.id+'&order=volgorde.asc&limit=1',{headers:otdH});
    const ogArr = ogRes.ok ? await ogRes.json() : [];
    const og = ogArr[0];
    if(!og || !og.email) return json(400,{error:'Opdrachtgever heeft geen e-mailadres; ondertekenen kan niet starten.'});
    const naam = [og.voornamen,og.tussenvoegsels,og.achternaam].filter(Boolean).join(' ') || 'Opdrachtgever';

    // 2. OTD-PDF ophalen via de bestaande otd-pdf-function
    const host = event.headers.host || 'otd-mva.netlify.app';
    const pdfRes = await fetch('https://'+host+'/.netlify/functions/otd-pdf?t='+encodeURIComponent(token));
    if(!pdfRes.ok) return json(502,{error:'Kon de PDF niet genereren ('+pdfRes.status+').'});
    const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());

    // 3. Signhost-transactie aanmaken
    const postbackUrl = 'https://'+host+'/.netlify/functions/otd-signhost-webhook';
    const createBody = {
      Signers: [{
        Email: og.email,
        SendSignRequest: false,           // geen aparte Signhost-mail; wij sturen direct door
        SignRequestMessage: 'Opdracht tot dienstverlening',
        Verifications: [{ Type: 'Consent' }]
      }],
      Reference: d.id,
      PostbackUrl: postbackUrl,
      DaysToExpire: 30,
      SendEmailNotifications: false
    };
    const cRes = await fetch(SIGNHOST_BASE+'/transaction', {
      method:'POST',
      headers: Object.assign({}, shH, { 'Content-Type':'application/json', 'Accept':'application/json' }),
      body: JSON.stringify(createBody)
    });
    const cText = await cRes.text();
    if(!cRes.ok) return json(502,{error:'Signhost: transactie aanmaken mislukt ('+cRes.status+'): '+cText.slice(0,300)});
    let trx; try { trx = JSON.parse(cText); } catch(e){ return json(502,{error:'Signhost: transactie-antwoord onleesbaar ('+cRes.status+'): '+cText.slice(0,200)}); }
    const trxId = trx.Id;
    if(!trxId) return json(502,{error:'Signhost gaf geen transactie-id terug.'});

    // 4. PDF uploaden
    const fileName = 'opdracht-tot-dienstverlening.pdf';
    const fRes = await fetch(SIGNHOST_BASE+'/transaction/'+trxId+'/file/'+encodeURIComponent(fileName), {
      method:'PUT',
      headers: Object.assign({}, shH, { 'Content-Type':'application/pdf' }),
      body: pdfBuf
    });
    if(!fRes.ok){ const t=await fRes.text(); return json(502,{error:'Signhost: document uploaden mislukt ('+fRes.status+'): '+t.slice(0,300)}); }

    // 5. transactie starten (antwoord mag leeg zijn — niet hard parsen)
    const sRes = await fetch(SIGNHOST_BASE+'/transaction/'+trxId+'/start', {
      method:'PUT',
      headers: Object.assign({}, shH, { 'Accept':'application/json' })
    });
    const sText = await sRes.text();
    if(!sRes.ok) return json(502,{error:'Signhost: starten mislukt ('+sRes.status+'): '+sText.slice(0,300)});

    // 6. SignUrl bepalen: eerst uit het start-antwoord, anders de transactie ophalen
    let signUrl = null;
    try { const st = sText ? JSON.parse(sText) : null; if(st && st.Signers && st.Signers[0]) signUrl = st.Signers[0].SignUrl; } catch(e){}
    if(!signUrl){
      const gRes = await fetch(SIGNHOST_BASE+'/transaction/'+trxId, { headers: Object.assign({}, shH, { 'Accept':'application/json' }) });
      const gText = await gRes.text();
      if(!gRes.ok) return json(502,{error:'Signhost: transactie ophalen mislukt ('+gRes.status+'): '+gText.slice(0,300)});
      let gt = null; try { gt = JSON.parse(gText); } catch(e){}
      if(gt && gt.Signers && gt.Signers[0]) signUrl = gt.Signers[0].SignUrl;
    }
    if(!signUrl) return json(502,{error:'Signhost gaf geen tekenlink (SignUrl) terug.'});

    // transactie-id opslaan (status blijft 'aangeboden' tot de webhook 'ondertekend' meldt)
    await fetch(OTD_URL+'/rest/v1/otd_dossiers?id=eq.'+encodeURIComponent(d.id), {
      method:'PATCH',
      headers: Object.assign({}, otdH, { 'Content-Type':'application/json', Prefer:'return=minimal' }),
      body: JSON.stringify({ signhost_transaction_id: trxId })
    });

    return json(200,{ ok:true, signUrl });
  } catch(e){ return json(500,{error:String((e&&e.message)||e)}); }
};
