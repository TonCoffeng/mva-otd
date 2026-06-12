// netlify/functions/otd-signhost-webhook.js
// Publieke postback-ontvanger voor Signhost. Signhost POST't hier de
// transactie-status. Status 30 = ondertekend -> dossier op 'ondertekend' zetten.
// At-least-once: kan meerdere keren binnenkomen; idempotent afgehandeld.
const OTD_URL = 'https://oonlagagxodohvakwfat.supabase.co';
const OTD_SERVICE_KEY = process.env.OTD_SERVICE_KEY;
const SIGNHOST_API_KEY = (process.env.SIGNHOST_API_KEY || '').trim();
const SIGNHOST_APP_KEY = (process.env.SIGNHOST_APP_KEY || '').trim();
const SIGNHOST_BASE = 'https://api.signhost.com/api';
const RESEND_API_KEY = process.env.RESEND_API_KEY_OTD || process.env.RESEND_API_KEY;
const LEADPOOL_URL = 'https://olfcrzusdkijxroxvsgm.supabase.co';
const LEADPOOL_SERVICE_KEY = process.env.LEADPOOL_SERVICE_KEY;
const ok = (obj) => ({ statusCode:200, headers:{'Content-Type':'application/json'}, body:JSON.stringify(obj||{ok:true}) });

// Na ondertekening: WWFT-zaak registreren in het centrale project (start klantonderzoek
// + basis voor doorbelasting Move-checks per makelaar). Idempotent via unieke index op
// otd_dossier_id; fouten mogen de webhook-ack nooit blokkeren.
async function maakWwftZaak(d, otdH){
  if(!LEADPOOL_SERVICE_KEY) return; // env ontbreekt: stilletjes overslaan
  const ogRes = await fetch(OTD_URL+'/rest/v1/otd_opdrachtgevers?select=voornamen,tussenvoegsels,achternaam,email&dossier_id=eq.'+d.id+'&order=volgorde.asc',{headers:otdH});
  const ogArr = ogRes.ok ? await ogRes.json() : [];
  let mak = null;
  if(d.makelaar_id){
    const mRes = await fetch(OTD_URL+'/rest/v1/otd_makelaars?select=naam,email&id=eq.'+d.makelaar_id,{headers:otdH});
    const mArr = mRes.ok ? await mRes.json() : [];
    mak = mArr[0] || null;
  }
  const zaak = {
    bron: 'otd',
    otd_dossier_id: String(d.id),
    object_adres: d.object_adres || null,
    documenttype: d.documenttype || null,
    makelaar_email: (mak && mak.email) || null,
    makelaar_naam: (mak && mak.naam) || null,
    opdrachtgevers: ogArr.map(o => ({
      naam: [o.voornamen, o.tussenvoegsels, o.achternaam].filter(Boolean).join(' '),
      email: o.email || null
    })),
    aantal_personen: Math.max(ogArr.length, 1),
    ondertekend_op: new Date().toISOString()
  };
  const ins = await fetch(LEADPOOL_URL+'/rest/v1/wwft_zaken', {
    method:'POST',
    headers: {
      apikey: LEADPOOL_SERVICE_KEY,
      Authorization: 'Bearer '+LEADPOOL_SERVICE_KEY,
      'Content-Type':'application/json',
      Prefer:'resolution=ignore-duplicates,return=representation' // idempotent: bestaande zaak blijft staan
    },
    body: JSON.stringify(zaak)
  });
  if(!ins.ok) return null;
  const rows = await ins.json().catch(()=>[]);
  return (rows && rows[0]) || null; // null bij duplicate (zaak bestond al → geen tweede actiemail)
}

// Na ondertekening: getekende OTD + voorwaarden (+ ondertekenbewijs) naar de klant,
// en een kopie naar de makelaar. Mailfouten mogen de webhook-ack nooit blokkeren.
async function verstuurGetekend(trxId, d, otdH, host, wwftZaak){
  if(!RESEND_API_KEY) return;
  const shH = { Authorization:'APIKey '+SIGNHOST_API_KEY, Application:'APPKey '+SIGNHOST_APP_KEY };

  // alle opdrachtgevers (eerste levert de aanhef; allen ontvangen het getekende exemplaar)
  const ogRes = await fetch(OTD_URL+'/rest/v1/otd_opdrachtgevers?select=voornamen,achternaam,email,volgorde&dossier_id=eq.'+d.id+'&order=volgorde.asc',{headers:otdH});
  const ogArr = ogRes.ok ? await ogRes.json() : [];
  const ontvangers = ogArr.filter(o=>o && o.email).map(o=>o.email);
  const og0 = ogArr[0] || {};
  if(!ontvangers.length) return;

  // makelaar
  let mak = null;
  if(d.makelaar_id){
    const mRes = await fetch(OTD_URL+'/rest/v1/otd_makelaars?select=naam,entiteit_naam,email&id=eq.'+d.makelaar_id,{headers:otdH});
    const mArr = mRes.ok ? await mRes.json() : [];
    mak = mArr[0] || null;
  }
  const makNaam = (mak && (mak.naam || mak.entiteit_naam)) || 'uw makelaar';
  const makEmail = (mak && mak.email) || null;

  // getekend document + ondertekenbewijs ophalen bij Signhost
  let signedB64 = null, receiptB64 = null;
  if(SIGNHOST_API_KEY && SIGNHOST_APP_KEY){
    try{
      const sd = await fetch(SIGNHOST_BASE+'/transaction/'+encodeURIComponent(trxId)+'/file/'+encodeURIComponent('opdracht-tot-dienstverlening.pdf'), { headers: Object.assign({}, shH, { Accept:'application/pdf' }) });
      if(sd.ok) signedB64 = Buffer.from(await sd.arrayBuffer()).toString('base64');
    }catch(e){}
    try{
      const rc = await fetch(SIGNHOST_BASE+'/file/receipt/'+encodeURIComponent(trxId), { headers: Object.assign({}, shH, { Accept:'application/pdf' }) });
      if(rc.ok) receiptB64 = Buffer.from(await rc.arrayBuffer()).toString('base64');
    }catch(e){}
  }

  const isAankoop = (d.documenttype === 'aankoop');
  const obj = d.object_adres || (isAankoop ? 'uw aankoopopdracht' : 'uw woning');
  const omschrijving = isAankoop ? ('uw aankoopbegeleiding' + (d.object_adres ? (' (' + d.object_adres + ')') : '')) : obj;
  const tipsPad = isAankoop ? '/na-ondertekening-aankoop.html' : '/na-ondertekening.html';
  const docsBase = 'https://'+host+'/docs/';
  const att = [];
  if(signedB64) att.push({ filename:'Opdracht-tot-dienstverlening-getekend.pdf', content: signedB64 });
  att.push({ filename:'Algemene-Consumentenvoorwaarden-Makelaardij.pdf', path: docsBase+'vbo-algemene-consumenten-voorwaarden-juli-2023-19534.pdf' });
  if(d.taal === 'nl_en') att.push({ filename:'General-Terms-and-Conditions-for-Consumers.pdf', path: docsBase+'General_terms_and_conditions_and_regulations_for_consumers.pdf' });
  if(receiptB64) att.push({ filename:'Ondertekenbewijs.pdf', content: receiptB64 });

  const eng = (d.taal === 'nl_en'); // knop NL+EN = klantcommunicatie in het Engels
  const aanhef = eng
    ? ('Dear ' + (og0.voornamen || 'Sir/Madam'))
    : ('Beste ' + (og0.voornamen || 'heer/mevrouw'));
  const omschrijvingMail = eng
    ? (isAankoop ? ('your purchase engagement' + (d.object_adres ? (' (' + d.object_adres + ')') : '')) : obj)
    : omschrijving;
  const T = eng ? {
    body1: 'Thank you! The service agreement (opdracht tot dienstverlening) for <strong>'+omschrijvingMail+'</strong> has been signed. Attached you will find the <strong>signed copy</strong> and the accompanying <strong>general terms and conditions</strong>'+(receiptB64?', as well as the signing receipt':'')+'.',
    body2: 'We will now get to work for you. What to expect in the coming period: <a href="https://'+host+tipsPad+'" style="color:#df5a0f;font-weight:bold">read more here &rsaquo;</a>',
    wwftKop: 'Next step: identification (Wwft)',
    wwft: 'As real estate agents we are legally required to verify the identity of our clients. The Wwft-check is being prepared for you in your Move.nl file &mdash; you can complete it (using Vidua or an ID upload) as soon as it is ready, usually within one business day.',
    wwftKnop: 'Go to Move.nl',
    groet: 'Kind regards,'
  } : {
    body1: 'Bedankt! De opdracht tot dienstverlening voor <strong>'+omschrijvingMail+'</strong> is ondertekend. In de bijlage vindt u het <strong>getekende exemplaar</strong> en de bijbehorende <strong>algemene voorwaarden</strong>'+(receiptB64?', plus het ondertekenbewijs':'')+'.',
    body2: 'Wij gaan nu voor u aan de slag. Wat er de komende periode op u afkomt, leest u <a href="https://'+host+tipsPad+'" style="color:#df5a0f;font-weight:bold">op deze pagina &rsaquo;</a>',
    wwftKop: 'Volgende stap: identificatie (Wwft)',
    wwft: 'Als makelaar zijn wij wettelijk verplicht onze opdrachtgevers te identificeren. De Wwft-check wordt voor u klaargezet in uw Move.nl-dossier &mdash; u kunt hem invullen (met Vidua of een ID-upload) zodra hij klaarstaat, doorgaans binnen &eacute;&eacute;n werkdag.',
    wwftKnop: 'Ga naar Move.nl',
    groet: 'Met vriendelijke groet,'
  };
  const klantHtml =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:auto;color:#27313f;line-height:1.55">' +
      '<div style="background:#16243f;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;border-bottom:3px solid #df5a0f"><strong style="font-size:15px;letter-spacing:1px">MAKELAARSVAN AMSTERDAM</strong></div>' +
      '<div style="border:1px solid #e9e3d8;border-top:none;border-radius:0 0 12px 12px;padding:26px 24px;background:#fffdfa">' +
        '<p style="margin:0 0 14px">'+aanhef+',</p>' +
        '<p style="margin:0 0 14px">'+T.body1+'</p>' +
        '<p style="margin:0 0 14px">'+T.body2+'</p>' +
        '<div style="background:#fdf1e8;border-left:3px solid #df5a0f;border-radius:0 8px 8px 0;padding:13px 16px;margin:0 0 18px">' +
          '<strong style="color:#df5a0f">'+T.wwftKop+'</strong><br>'+T.wwft+
          '<p style="text-align:center;margin:14px 0 2px"><a href="https://move.nl" style="background:#df5a0f;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-weight:bold;display:inline-block">'+T.wwftKnop+'</a></p>' +
        '</div>' +
        '<p style="margin:0">'+T.groet+'<br><strong>'+makNaam+'</strong><br><span style="color:#6c7689;font-size:13px">'+(makEmail||'amsterdam@makelaarsvan.nl')+' &middot; +31 (0)20 333 11 10</span></p>' +
      '</div>' +
      '<div style="text-align:center;color:#9aa3b3;font-size:11px;padding:14px">MakelaarsVan Amsterdam &middot; Valkenburgerstraat 67, 1011 MG Amsterdam</div>' +
    '</div>';
  const klantPayload = { from:'MakelaarsVan Amsterdam <noreply@makelaarsvan.nl>', to: ontvangers, subject:(eng ? 'Your signed service agreement — ' : 'Uw getekende opdracht tot dienstverlening — ')+(isAankoop ? (d.object_adres || (eng ? 'purchase support' : 'aankoopbegeleiding')) : obj), html: klantHtml, attachments: att };
  if(makEmail) klantPayload.reply_to = makEmail;
  await fetch('https://api.resend.com/emails',{ method:'POST', headers:{ Authorization:'Bearer '+RESEND_API_KEY, 'Content-Type':'application/json' }, body: JSON.stringify(klantPayload) });

  // kopie naar de makelaar (getekend exemplaar + diens eigen mailadres vermeld)
  if(makEmail){
    const klantNaam = [og0.voornamen, og0.achternaam].filter(Boolean).join(' ') || ontvangers[0];
    const makAtt = [];
    if(signedB64) makAtt.push({ filename:'Opdracht-tot-dienstverlening-getekend.pdf', content: signedB64 });
    if(receiptB64) makAtt.push({ filename:'Ondertekenbewijs.pdf', content: receiptB64 });
    const makHtml =
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:auto;color:#27313f;line-height:1.55">' +
        '<div style="background:#16243f;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;border-bottom:3px solid #df5a0f"><strong style="font-size:14px;letter-spacing:1px">MVA — getekende OTD</strong></div>' +
        '<div style="border:1px solid #e9e3d8;border-top:none;border-radius:0 0 12px 12px;padding:22px;background:#fffdfa">' +
          '<p style="margin:0 0 12px">De opdracht voor <strong>'+omschrijving+'</strong> is ondertekend door <strong>'+klantNaam+'</strong>.</p>' +
          '<p style="margin:0 0 12px">Het getekende exemplaar zit in de bijlage, ter archivering.</p>' +
          (wwftZaak && wwftZaak.actie_token ? (
            '<div style="background:#fdf1e8;border-left:3px solid #df5a0f;border-radius:0 8px 8px 0;padding:13px 16px;margin:0 0 14px">' +
              '<strong style="color:#df5a0f">Nu: Wwft-check versturen</strong><br>' +
              'Verstuur de Wwft-check naar de opdrachtgever(s): open in Realworks het object &rarr; relatie &rarr; Move.nl-knop &rarr; <i>Start/Open Wwft Dossier</i> &rarr; <i>Versturen</i>. Of laat Monique het regelen (verwerking binnen 24 uur).' +
              '<p style="text-align:center;margin:14px 0 4px">' +
                '<a href="https://crm.realworks.nl" style="background:#16243f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;display:inline-block;margin:3px">Zelf starten in Realworks</a> ' +
                '<a href="https://'+host+'/.netlify/functions/otd-wwft-keuze?id='+wwftZaak.id+'&t='+wwftZaak.actie_token+'&keuze=gestart" style="background:#1d7a3f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;display:inline-block;margin:3px">&#10003; Check verstuurd</a> ' +
                '<a href="https://'+host+'/.netlify/functions/otd-wwft-keuze?id='+wwftZaak.id+'&t='+wwftZaak.actie_token+'&keuze=monique" style="background:#fff;color:#16243f;border:1.5px solid #16243f;text-decoration:none;padding:9px 18px;border-radius:8px;font-weight:bold;display:inline-block;margin:3px">Laat Monique het regelen</a>' +
              '</p>' +
            '</div>'
          ) : '') +
          '<p style="margin:0;color:#6c7689;font-size:13px">Makelaar: '+makNaam+' ('+makEmail+')</p>' +
        '</div></div>';
    await fetch('https://api.resend.com/emails',{ method:'POST', headers:{ Authorization:'Bearer '+RESEND_API_KEY, 'Content-Type':'application/json' }, body: JSON.stringify({ from:'MakelaarsVan Amsterdam <noreply@makelaarsvan.nl>', to:[makEmail], subject:'Getekende OTD — '+(isAankoop ? ('aankoop ' + (d.object_adres || '')).trim() : obj), html: makHtml, attachments: makAtt }) });
  }
}

// Zodra alle opdrachtgevers getekend hebben (maar de makelaar nog niet): persoonlijke
// MVA-mail aan de makelaar met zijn tekenlink. Eenmalig (vlag makelaar_uitgenodigd_op).
async function nodigMakelaarUit(trxId, d, otdH){
  if(!RESEND_API_KEY || d.makelaar_uitgenodigd_op) return;
  const shH = { Authorization:'APIKey '+SIGNHOST_API_KEY, Application:'APPKey '+SIGNHOST_APP_KEY };

  // makelaar ophalen
  if(!d.makelaar_id) return;
  const mRes = await fetch(OTD_URL+'/rest/v1/otd_makelaars?select=naam,email&id=eq.'+d.makelaar_id,{headers:otdH});
  const mArr = mRes.ok ? await mRes.json() : [];
  const mak = mArr[0];
  if(!mak || !mak.email) return;
  const makEmailLc = mak.email.toLowerCase();

  // transactie ophalen: zijn alle anderen klaar en heeft de makelaar een actieve SignUrl?
  const gRes = await fetch(SIGNHOST_BASE+'/transaction/'+encodeURIComponent(trxId), { headers: Object.assign({}, shH, { Accept:'application/json' }) });
  if(!gRes.ok) return;
  let trx = null; try { trx = JSON.parse(await gRes.text()); } catch(e){ return; }
  const signers = Array.isArray(trx && trx.Signers) ? trx.Signers : [];
  const makSigner = signers.find(sg => sg && sg.Email && sg.Email.toLowerCase() === makEmailLc);
  if(!makSigner || makSigner.SignedDateTime) return; // geen makelaar-signer, of hij heeft al getekend
  const anderen = signers.filter(sg => sg && sg.Email && sg.Email.toLowerCase() !== makEmailLc);
  if(!anderen.length || !anderen.every(sg => sg.SignedDateTime)) return; // opdrachtgevers nog niet allemaal klaar
  if(!makSigner.SignUrl) return;

  // eerste opdrachtgever voor de aanhef
  const ogRes = await fetch(OTD_URL+'/rest/v1/otd_opdrachtgevers?select=voornamen,tussenvoegsels,achternaam&dossier_id=eq.'+d.id+'&order=volgorde.asc',{headers:otdH});
  const ogArr = ogRes.ok ? await ogRes.json() : [];
  const klantNamen = ogArr.map(o=>[o.voornamen,o.tussenvoegsels,o.achternaam].filter(Boolean).join(' ')).filter(Boolean).join(' en ') || 'De opdrachtgever';
  const voornaamMak = (mak.naam||'').split(' ')[0] || mak.naam || 'collega';
  const isAankoopM = (d.documenttype === 'aankoop');
  const objM = d.object_adres || (isAankoopM ? 'de aankoopopdracht' : 'de opdracht');

  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:auto;color:#27313f;line-height:1.55">' +
      '<div style="background:#16243f;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;border-bottom:3px solid #df5a0f"><strong style="font-size:14px;letter-spacing:1px">MVA — jouw handtekening</strong></div>' +
      '<div style="border:1px solid #e9e3d8;border-top:none;border-radius:0 0 12px 12px;padding:24px 22px;background:#fffdfa">' +
        '<p style="margin:0 0 12px">Hoi '+voornaamMak+',</p>' +
        '<p style="margin:0 0 12px">Goed nieuws: <b>'+klantNamen+'</b> heeft de opdracht tot dienstverlening voor <b>'+objM+'</b> ondertekend. Als laatste stap zet jij je handtekening &mdash; daarmee is de opdracht rond en gaan de bevestigingen automatisch de deur uit.</p>' +
        '<p style="text-align:center;margin:22px 0"><a href="'+makSigner.SignUrl+'" style="background:#df5a0f;color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:bold;display:inline-block">Onderteken de opdracht</a></p>' +
        '<p style="margin:0;color:#6c7689;font-size:13px">Duurt een halve minuut. Daarna ontvangen jij en de klant het getekende exemplaar per mail.</p>' +
      '</div></div>';
  await fetch('https://api.resend.com/emails',{ method:'POST', headers:{ Authorization:'Bearer '+RESEND_API_KEY, 'Content-Type':'application/json' }, body: JSON.stringify({
    from:'MakelaarsVan Amsterdam <noreply@makelaarsvan.nl>',
    to:[mak.email],
    subject:'Jouw handtekening — '+objM,
    html: html
  }) });

  // vlag zetten: niet nogmaals mailen bij volgende postbacks
  await fetch(OTD_URL+'/rest/v1/otd_dossiers?id=eq.'+encodeURIComponent(d.id), {
    method:'PATCH',
    headers: Object.assign({}, otdH, { 'Content-Type':'application/json', Prefer:'return=minimal' }),
    body: JSON.stringify({ makelaar_uitgenodigd_op: new Date().toISOString() })
  });
}

// Na volledige ondertekening: welkom/stappenplan-mail (brochure-mail) via de
// communicatie-app — de ene uitgaande poort. De webhook schrijft alleen het event
// en triggert de mail-motor; templates en routing leven in mva-communicatie.
// Idempotent via de d.status-guard in de handler + het verwerkt-slot in verstuur-mail.
// Fouten hier mogen de webhook-ack nooit blokkeren.
const COMMUNICATIE_VERSTUUR_URL = 'https://mva-communicatie.netlify.app/.netlify/functions/verstuur-mail';

async function schrijfWelkomstmailEvent(d, otdH){
  if(!LEADPOOL_SERVICE_KEY) return; // env ontbreekt: stilletjes overslaan

  // eerste opdrachtgever = ontvanger + aanhef
  const ogRes = await fetch(OTD_URL+'/rest/v1/otd_opdrachtgevers?select=voornamen,tussenvoegsels,achternaam,email&dossier_id=eq.'+d.id+'&order=volgorde.asc&limit=1',{headers:otdH});
  const ogArr = ogRes.ok ? await ogRes.json() : [];
  const og0 = ogArr[0];
  if(!og0 || !og0.email) return; // zonder klantadres geen welkomstmail

  // makelaar
  let mak = null;
  if(d.makelaar_id){
    const mRes = await fetch(OTD_URL+'/rest/v1/otd_makelaars?select=naam,email&id=eq.'+d.makelaar_id,{headers:otdH});
    const mArr = mRes.ok ? await mRes.json() : [];
    mak = mArr[0] || null;
  }

  const evt = {
    event_type: (d.documenttype === 'aankoop') ? 'otd_getekend_aankoop' : 'otd_getekend_verkoop',
    bron: 'mva-otd',
    payload: {
      klant_naam: [og0.voornamen, og0.tussenvoegsels, og0.achternaam].filter(Boolean).join(' '),
      klant_email: og0.email,
      makelaar_naam: (mak && mak.naam) || null,
      makelaar_email: (mak && mak.email) || null,
      pand_adres: d.object_adres || null,
      taal: (d.taal === 'nl_en') ? 'en' : 'nl', // tweetalige opdracht = Engelstalige klant
      otd_dossier_id: String(d.id)
    },
    status: 'nieuw'
  };

  const ins = await fetch(LEADPOOL_URL+'/rest/v1/communicatie_events', {
    method:'POST',
    headers: {
      apikey: LEADPOOL_SERVICE_KEY,
      Authorization: 'Bearer '+LEADPOOL_SERVICE_KEY,
      'Content-Type':'application/json',
      Prefer:'return=representation'
    },
    body: JSON.stringify(evt)
  });
  if(!ins.ok) return;
  const rows = await ins.json().catch(()=>[]);
  const eventId = rows && rows[0] && rows[0].id;
  if(!eventId) return;

  // mail-motor triggeren; het verwerkt-slot daar voorkomt dubbele verzending
  await fetch(COMMUNICATIE_VERSTUUR_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ event_id: eventId })
  });
}

exports.handler = async (event) => {
  try {
    if(event.httpMethod !== 'POST') return ok({ ignored:'methode' });
    if(!OTD_SERVICE_KEY) return ok({ error:'serverconfig' });

    let body = {};
    try { body = JSON.parse(event.body||'{}'); } catch(e){ return ok({ error:'geen json' }); }

    // Signhost kan de transactie genest (body.Transaction) of plat aanleveren
    const trx = body.Transaction || body;
    const trxId = trx.Id || body.Id;
    const status = (trx.Status != null) ? trx.Status : body.Status;
    if(!trxId) return ok({ ignored:'geen transactie-id' });

    const otdH = { apikey:OTD_SERVICE_KEY, Authorization:'Bearer '+OTD_SERVICE_KEY };

    // dossier zoeken op de opgeslagen transactie-id (alleen bekende dossiers worden geraakt)
    const dRes = await fetch(OTD_URL+'/rest/v1/otd_dossiers?select=id,status,object_adres,makelaar_id,klant_token,taal,documenttype,makelaar_uitgenodigd_op&signhost_transaction_id=eq.'+encodeURIComponent(trxId)+'&limit=1',{headers:otdH});
    const dArr = dRes.ok ? await dRes.json() : [];
    const d = dArr[0];
    if(!d) return ok({ ignored:'onbekende transactie' });

    // status 30 = Signed
    if(Number(status) === 30 && d.status !== 'ondertekend'){
      // 1) status idempotent op 'ondertekend' (voorkomt dubbele mail bij herhaalde webhook)
      await fetch(OTD_URL+'/rest/v1/otd_dossiers?id=eq.'+encodeURIComponent(d.id), {
        method:'PATCH',
        headers: Object.assign({}, otdH, { 'Content-Type':'application/json', Prefer:'return=minimal' }),
        body: JSON.stringify({ status:'ondertekend', ondertekend_op: new Date().toISOString() })
      });
      // 2) WWFT-zaak registreren in het centrale project (start klantonderzoek + doorbelasting)
      let wwftZaak = null;
      try { wwftZaak = await maakWwftZaak(d, otdH); } catch(e){ /* wwft-fout blokkeert de ack niet */ }
      // 3) getekende OTD + voorwaarden naar klant + kopie/actiemail makelaar
      const host = (event.headers && event.headers.host) || 'otd-mva.netlify.app';
      try { await verstuurGetekend(trxId, d, otdH, host, wwftZaak); } catch(e){ /* mailfout blokkeert de ack niet */ }
      // 4) welkom/stappenplan-mail (brochure) via de communicatie-app — de ene poort
      try { await schrijfWelkomstmailEvent(d, otdH); } catch(e){ /* blokkeert de ack niet */ }
      return ok({ updated:'ondertekend', dossier:d.id });
    }

    // Tussenstand: mogelijk hebben alle opdrachtgevers net getekend → makelaar persoonlijk uitnodigen
    if(d.status !== 'ondertekend'){
      try { await nodigMakelaarUit(trxId, d, otdH); } catch(e){ /* blokkeert de ack niet */ }
    }
    return ok({ ontvangen:true, status });
  } catch(e){ return ok({ error:String((e&&e.message)||e) }); }
};
