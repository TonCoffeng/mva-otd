// netlify/functions/otd-ondertekenen.js
// POST ?t=TOKEN  (publiek, token = sleutel — net als otd-klant/otd-pdf)
// Maakt een Signhost-ondertekentransactie aan voor ALLE opdrachtgevers met een e-mailadres:
//  1) haalt de OTD-PDF op (via otd-pdf), 2) maakt transactie met een signer per opdrachtgever
//     (op volgorde; 1e tekent via de klant-link, volgende(n) krijgen een Signhost-uitnodiging),
//  3) upload PDF, 4) start transactie, 5) geeft de SignUrl van de eerste ondertekenaar terug.
// De webhook zet de status pas op 'ondertekend' als de hele transactie is afgerond.
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
    const dRes = await fetch(OTD_URL+'/rest/v1/otd_dossiers?select=id,status,object_adres,klant_token,signhost_transaction_id,makelaar_id&klant_token=eq.'+encodeURIComponent(token)+'&limit=1',{headers:otdH});
    const dArr = dRes.ok ? await dRes.json() : [];
    const d = dArr[0];
    if(!d) return json(404,{error:'Deze link is niet (meer) geldig.'});
    if(d.status === 'ondertekend') return json(409,{error:'Deze opdracht is al ondertekend.'});

    // opdrachtgevers — alle met een e-mailadres worden ondertekenaar (op volgorde)
    const ogRes = await fetch(OTD_URL+'/rest/v1/otd_opdrachtgevers?select=voornamen,tussenvoegsels,achternaam,email,volgorde&dossier_id=eq.'+d.id+'&order=volgorde.asc',{headers:otdH});
    const ogArr = ogRes.ok ? await ogRes.json() : [];
    const ondertekenaars = ogArr.filter(o=>o && o.email);
    if(!ondertekenaars.length) return json(400,{error:'Geen enkele opdrachtgever heeft een e-mailadres; ondertekenen kan niet starten.'});

    // makelaar ophalen (tekent als laatste mee — tweezijdige overeenkomst)
    let makelaarEmail = null;
    if(d.makelaar_id){
      const mRes = await fetch(OTD_URL+'/rest/v1/otd_makelaars?select=email&id=eq.'+d.makelaar_id,{headers:otdH});
      const mArr = mRes.ok ? await mRes.json() : [];
      if(mArr[0] && mArr[0].email) makelaarEmail = mArr[0].email;
    }

    // 2. OTD-PDF ophalen via de bestaande otd-pdf-function
    const host = event.headers.host || 'otd-mva.netlify.app';
    const pdfRes = await fetch('https://'+host+'/.netlify/functions/otd-pdf?t='+encodeURIComponent(token));
    if(!pdfRes.ok) return json(502,{error:'Kon de PDF niet genereren ('+pdfRes.status+').'});
    const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());

    // 3. Signhost-transactie aanmaken
    // Volgorde: eerst alle opdrachtgevers, daarna de makelaar (medeondertekenaar).
    // dossier-taal en namen voor persoonlijke Signhost-berichten
    const taalRes = await fetch(OTD_URL+'/rest/v1/otd_dossiers?select=taal,documenttype&id=eq.'+d.id+'&limit=1',{headers:otdH});
    const taalArr = taalRes.ok ? await taalRes.json() : [];
    const eng = !!(taalArr[0] && taalArr[0].taal === 'nl_en');
    const naamVan = (o) => [o.voornamen, o.tussenvoegsels, o.achternaam].filter(Boolean).join(' ');
    const eersteNaam = naamVan(ondertekenaars[0]) || ondertekenaars[0].email;
    const signers = ondertekenaars.map((o, i) => ({
      email: o.email,
      // 1e tekent via de klant-link (geen Signhost-mail); volgende(n) krijgen een persoonlijk bericht
      bericht: eng
        ? (eersteNaam + ' has signed the service agreement for ' + (d.object_adres || 'your engagement') + '. You are next — please review and sign.')
        : (eersteNaam + ' heeft de opdracht tot dienstverlening voor ' + (d.object_adres || 'uw opdracht') + ' ondertekend. Nu bent u aan de beurt — leest u het document na en onderteken het.'),
      sendRequest: i > 0
    }));
    // makelaar tekent als laatste; Signhost mailt hem NIET — onze webhook stuurt een
    // persoonlijke MVA-mail zodra alle opdrachtgevers getekend hebben
    if(makelaarEmail) signers.push({ email: makelaarEmail, bericht: 'Opdracht tot dienstverlening', sendRequest: false });
    const postbackUrl = 'https://'+host+'/.netlify/functions/otd-signhost-webhook';
    const createBody = {
      Signers: signers.map((sg,i)=>({
        Email: sg.email,
        SendSignRequest: sg.sendRequest,
        SignRequestMessage: sg.bericht,
        Language: (eng && i < ondertekenaars.length) ? 'en-US' : 'nl-NL',
        SignOrder: i+1,
        Verifications: [{ Type: 'Scribble', RequireHandsignature: true }]
      })),
      Reference: d.id,
      PostbackUrl: postbackUrl,
      DaysToExpire: 30,
      Language: 'nl-NL',
      SendEmailNotifications: false      // wij sturen zelf het getekende exemplaar + voorwaarden (via de webhook); Signhost mailt geen kopie
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

    // 6. SignUrl van de eerste ondertekenaar bepalen (uit start-antwoord, anders transactie ophalen)
    const eersteEmail = (ondertekenaars[0].email || '').toLowerCase();
    const vindSignUrl = (obj) => {
      if(!obj || !Array.isArray(obj.Signers)) return null;
      const m = obj.Signers.find(s=>s && s.Email && s.Email.toLowerCase()===eersteEmail);
      return (m && m.SignUrl) || (obj.Signers[0] && obj.Signers[0].SignUrl) || null;
    };
    let signUrl = null;
    try { signUrl = vindSignUrl(sText ? JSON.parse(sText) : null); } catch(e){}
    if(!signUrl){
      const gRes = await fetch(SIGNHOST_BASE+'/transaction/'+trxId, { headers: Object.assign({}, shH, { 'Accept':'application/json' }) });
      const gText = await gRes.text();
      if(!gRes.ok) return json(502,{error:'Signhost: transactie ophalen mislukt ('+gRes.status+'): '+gText.slice(0,300)});
      let gt = null; try { gt = JSON.parse(gText); } catch(e){}
      signUrl = vindSignUrl(gt);
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
