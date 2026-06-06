// netlify/functions/otd-pdf.js
// Genereert de OTD als PDF op basis van een klant-token (?t=TOKEN).
// Publiek (token = sleutel), net als otd-klant. Geeft application/pdf terug.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const OTD_URL = 'https://oonlagagxodohvakwfat.supabase.co';
const OTD_SERVICE_KEY = process.env.OTD_SERVICE_KEY;

function datumNL(s){ if(!s) return ''; const m=String(s).match(/(\d{4})-(\d{2})-(\d{2})/); return m? m[3]+'-'+m[2]+'-'+m[1] : s; }
function courtageTekst(d){
  if(d.courtage_type==='percentage' && d.courtage_pct_incl!=null) return String(d.courtage_pct_incl).replace('.',',')+'% incl. btw van de verkoopprijs';
  if(d.courtage_vast_bedrag!=null) return '€ '+Number(d.courtage_vast_bedrag).toLocaleString('nl-NL')+' incl. btw (vast)';
  return '—';
}

async function genereerOtdPdf({ dossier, opdrachtgevers, makelaar, regels }){
  const d = dossier||{}, ogs = opdrachtgevers||[], m = makelaar||{}, rgs = regels||[];
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy=rgb(0.106,0.165,0.290), oranje=rgb(0.918,0.345,0.047), grijs=rgb(0.39,0.45,0.55), zwart=rgb(0.12,0.16,0.25);
  let page = doc.addPage([595.28,841.89]);
  const M=56, W=595.28-M*2; let y=786;
  const euro = n => (n==null||n==='') ? '—' : '€ ' + Number(n).toLocaleString('nl-NL');
  const txt = (s,x,yy,o={}) => page.drawText(String(s==null?'':s),{x,y:yy,size:o.size||10.5,font:o.bold?bold:font,color:o.color||zwart});
  function nieuw(minY){ if(y<minY){ page=doc.addPage([595.28,841.89]); y=786; } }
  function sectie(t){ nieuw(120); txt(t.toUpperCase(),M,y,{bold:true,size:9.5,color:oranje}); y-=17; }
  function rij(k,v){ nieuw(90); txt(k,M,y,{size:10.5,color:grijs}); txt(v==null?'—':String(v),M+170,y,{size:10.5,bold:true}); y-=17; }
  function wrap(s,maxW){ const woorden=String(s).split(/\s+/); let line=''; const size=10;
    woorden.forEach(w=>{ const t=line?line+' '+w:w; if(font.widthOfTextAtSize(t,size)>maxW){ nieuw(90); txt(line,M,y,{size}); y-=15; line=w; } else line=t; });
    if(line){ nieuw(90); txt(line,M,y,{size}); y-=15; } }

  txt('MAKELAARSVAN AMSTERDAM',M,y,{bold:true,size:13,color:navy}); y-=26;
  txt((d.documenttype==='aankoop')?'Opdracht tot dienstverlening — aankoop':'Opdracht tot dienstverlening — verkoop',M,y,{bold:true,size:16,color:navy}); y-=16;
  txt((m.entiteit_naam||'MakelaarsVan Amsterdam')+(d.datum_opdracht?('   ·   '+datumNL(d.datum_opdracht)):''),M,y,{size:9.5,color:grijs}); y-=22;
  page.drawLine({start:{x:M,y},end:{x:M+W,y},thickness:1,color:rgb(0.9,0.92,0.95)}); y-=24;

  sectie('Object');
  rij('Adres',[d.object_adres,[d.object_postcode,d.object_plaats].filter(Boolean).join(' ')].filter(Boolean).join(', '));
  if(d.bouwvorm) rij('Bouwvorm',d.bouwvorm);
  if(d.soort_object) rij('Soort object',d.soort_object);
  rij('Bestemming',d.bestemming); rij('In gebruik als',d.in_gebruik_als); rij('Vraagprijs',euro(d.vraagprijs)); y-=8;

  sectie('Opdrachtgever'+(ogs.length>1?'s':''));
  if(ogs.length){ ogs.forEach(o=>{ const naam=[o.voornamen,o.tussenvoegsels,o.achternaam].filter(Boolean).join(' ')||'—'; rij(naam,[o.email,o.telefoon_mobiel].filter(Boolean).join('  ·  ')); }); } else rij('—','');
  y-=8;

  sectie('Courtage & voorwaarden'); rij('Courtage',courtageTekst(d)); rij('Looptijd',d.looptijd||'onbepaalde tijd'); y-=8;
  if(d.bijzonderheden){ sectie('Bijzonderheden'); wrap(d.bijzonderheden,W); y-=8; }

  // Woningpromotieplan (gekozen diensten + totaal)
  if(rgs.length){
    const euro2 = n => '€ '+Number(n||0).toLocaleString('nl-NL',{minimumFractionDigits:2,maximumFractionDigits:2});
    const prijsRij = (naam, prijs, opt={}) => {
      nieuw(90);
      txt(naam, M, y, {size:10.5, bold:!!opt.bold, color:opt.bold?navy:zwart});
      const f = opt.bold?bold:font, p = euro2(prijs), pw = f.widthOfTextAtSize(p,10.5);
      txt(p, M+W-pw, y, {size:10.5, bold:!!opt.bold, color:opt.bold?navy:zwart});
      y-=16;
    };
    sectie('Woningpromotieplan');
    let totaal=0;
    rgs.forEach(r=>{ const nm=(r.naam||'—'); const pr=Number(r.prijs_snapshot||0); totaal+=pr; prijsRij(nm, pr); });
    nieuw(90); page.drawLine({start:{x:M+W-170,y:y+9},end:{x:M+W,y:y+9},thickness:0.8,color:rgb(0.8,0.83,0.88)}); y-=2;
    prijsRij('Totaal', totaal, {bold:true}); y-=8;
  }

  nieuw(150); y-=18; page.drawLine({start:{x:M,y},end:{x:M+W,y},thickness:1,color:rgb(0.9,0.92,0.95)}); y-=22;
  txt('Door digitale ondertekening verklaart opdrachtgever akkoord te gaan met bovenstaande opdracht tot dienstverlening.',M,y,{size:9,color:grijs}); y-=40;
  txt('Handtekening opdrachtgever:',M,y,{size:10}); page.drawLine({start:{x:M+160,y:y-2},end:{x:M+360,y:y-2},thickness:0.8,color:grijs});

  return await doc.save();
}

exports.handler = async (event) => {
  try{
    if(!OTD_SERVICE_KEY) return { statusCode:500, body:'Serverconfig ontbreekt.' };
    const otdH = { apikey:OTD_SERVICE_KEY, Authorization:'Bearer '+OTD_SERVICE_KEY };
    const token = ((event.queryStringParameters && event.queryStringParameters.t)||'').trim();
    if(!token) return { statusCode:400, body:'Geen geldige link.' };

    const dRes = await fetch(OTD_URL+'/rest/v1/otd_dossiers?select=*&klant_token=eq.'+encodeURIComponent(token)+'&limit=1',{headers:otdH});
    const dArr = dRes.ok ? await dRes.json() : [];
    const d = dArr[0];
    if(!d) return { statusCode:404, body:'Deze link is niet (meer) geldig.' };

    const ogRes = await fetch(OTD_URL+'/rest/v1/otd_opdrachtgevers?select=voornamen,tussenvoegsels,achternaam,email,telefoon_mobiel,volgorde&dossier_id=eq.'+d.id+'&order=volgorde.asc',{headers:otdH});
    const opdrachtgevers = ogRes.ok ? await ogRes.json() : [];
    const rRes = await fetch(OTD_URL+'/rest/v1/otd_regels?select=prijs_snapshot,volgorde,sectie,otd_producten(naam,commerciele_naam)&dossier_id=eq.'+d.id+'&order=volgorde.asc',{headers:otdH});
    const rRows = rRes.ok ? await rRes.json() : [];
    const regels = rRows.map(r=>({
      naam: (r.otd_producten && (r.otd_producten.commerciele_naam || r.otd_producten.naam)) || '',
      prijs_snapshot: r.prijs_snapshot, sectie: r.sectie, volgorde: r.volgorde
    }));
    let makelaar = null;
    if(d.makelaar_id){
      const mRes = await fetch(OTD_URL+'/rest/v1/otd_makelaars?select=naam,entiteit_naam&id=eq.'+d.makelaar_id,{headers:otdH});
      const mArr = mRes.ok ? await mRes.json() : []; makelaar = mArr[0]||null;
    }
    const bytes = await genereerOtdPdf({ dossier:d, opdrachtgevers, makelaar, regels });
    const b64 = Buffer.from(bytes).toString('base64');
    return {
      statusCode:200,
      headers:{ 'Content-Type':'application/pdf', 'Content-Disposition':'inline; filename="opdracht-tot-dienstverlening.pdf"' },
      body:b64, isBase64Encoded:true
    };
  }catch(e){ return { statusCode:500, body:'PDF-fout: '+String((e&&e.message)||e) }; }
};
module.exports.genereerOtdPdf = genereerOtdPdf;
