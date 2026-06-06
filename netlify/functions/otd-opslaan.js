// netlify/functions/otd-opslaan.js
// GET  -> geeft de eigen makelaar-id van de ingelogde gebruiker + (voor directie)
//         de lijst actieve makelaars voor de "namens"-keuze.
// POST -> slaat een nieuw concept-dossier + opdrachtgever op.
// Beveiliging: een makelaar krijgt altijd zijn eigen makelaar-id; alleen directie
// mag namens een gekozen makelaar opslaan.
const LEADPOOL_URL  = 'https://olfcrzusdkijxroxvsgm.supabase.co';
const LEADPOOL_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sZmNyenVzZGtpanhyb3h2c2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDEyOTQsImV4cCI6MjA5MzQ3NzI5NH0.wPygjZCIxzTTOVc2uafMtnESB0iYkxR3yF-AuiL63zc';
const OTD_URL = 'https://oonlagagxodohvakwfat.supabase.co';
const OTD_SERVICE_KEY = process.env.OTD_SERVICE_KEY;

const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

function parseNLNum(s){
  if(s===null||s===undefined) return null;
  const t=String(s).replace(/\s/g,'').replace(/\./g,'').replace(',','.');
  if(t==='') return null;
  const n=parseFloat(t); return isNaN(n)?null:n;
}
function parseNLDate(s){
  if(!s) return null;
  const m=String(s).match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if(!m) return null;
  return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
}

exports.handler = async (event) => {
  try {
    if(!OTD_SERVICE_KEY) return json(500,{error:'Serverconfig ontbreekt (OTD_SERVICE_KEY).'});
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

    const otdH = { apikey:OTD_SERVICE_KEY, Authorization:'Bearer '+OTD_SERVICE_KEY, 'Content-Type':'application/json' };

    // eigen makelaar (koppeling op e-mail)
    const mRes = await fetch(OTD_URL+'/rest/v1/otd_makelaars?select=id&email=eq.'+encodeURIComponent(email),{headers:otdH});
    const mArr = mRes.ok ? await mRes.json() : [];
    const eigenMakelaarId = mArr[0] ? mArr[0].id : null;

    if(event.httpMethod === 'GET'){
      let makelaars = [];
      if(isDirectie){
        const lRes = await fetch(OTD_URL+'/rest/v1/otd_makelaars?select=id,naam,entiteit_naam&actief=eq.true&order=naam.asc',{headers:otdH});
        makelaars = lRes.ok ? await lRes.json() : [];
      }
      return json(200,{ is_directie:!!isDirectie, eigen_makelaar_id:eigenMakelaarId, makelaars });
    }

    if(event.httpMethod === 'POST'){
      const body = JSON.parse(event.body||'{}');

      // makelaar bepalen — makelaar = altijd zichzelf; directie = gekozen makelaar
      let makelaarId = eigenMakelaarId;
      if(isDirectie){
        makelaarId = body.makelaar_id || null;
        if(!makelaarId) return json(400,{error:'Kies een makelaar voor wie je de opdracht opstelt.'});
        const chk = await fetch(OTD_URL+'/rest/v1/otd_makelaars?select=id&id=eq.'+encodeURIComponent(makelaarId),{headers:otdH});
        const chkArr = chk.ok ? await chk.json() : [];
        if(!chkArr[0]) return json(400,{error:'Gekozen makelaar bestaat niet.'});
      }
      if(!makelaarId) return json(400,{error:'Geen makelaar gekoppeld aan dit account.'});

      const ct = (body.courtage_type==='vast_bedrag') ? 'vast_bedrag' : 'percentage';
      const dossier = {
        documenttype: body.documenttype==='aankoop' ? 'aankoop' : 'verkoop',
        makelaar_id: makelaarId,
        object_adres: body.object_adres || null,
        object_plaats: body.object_plaats || null,
        object_postcode: body.object_postcode || null,
        realworks_object_id: body.realworks_object_id || null,
        bestemming: body.bestemming || null,
        in_gebruik_als: body.in_gebruik_als || null,
        bouwvorm: body.bouwvorm || null,
        soort_object: body.soort_object || null,
        vraagprijs: parseNLNum(body.vraagprijs),
        datum_opdracht: parseNLDate(body.datum_opdracht),
        courtage_type: ct,
        courtage_pct_incl: ct==='percentage' ? parseNLNum(body.courtage_pct) : null,
        courtage_vast_bedrag: ct==='vast_bedrag' ? parseNLNum(body.courtage_vast) : null,
        cloze_id: body.cloze_id || null,
        herkomst_relatie: body.herkomst || null,
        reden_opdracht: body.reden || null,
        status: 'concept'
      };

      const dRes = await fetch(OTD_URL+'/rest/v1/otd_dossiers',{method:'POST',headers:Object.assign({},otdH,{Prefer:'return=representation'}),body:JSON.stringify(dossier)});
      if(!dRes.ok){ const t=await dRes.text(); return json(500,{error:'Opslaan dossier faalde ('+dRes.status+'): '+t}); }
      const dRows = await dRes.json();
      const dossierId = dRows[0] && dRows[0].id;
      if(!dossierId) return json(500,{error:'Geen dossier-id terug.'});

      const og = body.opdrachtgever || {};
      const ogRow = {
        dossier_id: dossierId,
        volgorde: 1,
        type: 'particulier',
        voornamen: og.voornamen || null,
        achternaam: og.achternaam || null,
        email: og.email || null,
        telefoon_mobiel: og.telefoon || null,
        geboorteplaats: og.geboorteplaats || null,
        geboortedatum: parseNLDate(og.geboortedatum)
      };
      const ogRes = await fetch(OTD_URL+'/rest/v1/otd_opdrachtgevers',{method:'POST',headers:otdH,body:JSON.stringify(ogRow)});
      if(!ogRes.ok){ const t=await ogRes.text(); return json(500,{error:'Dossier opgeslagen, opdrachtgever faalde ('+ogRes.status+'): '+t, dossier_id:dossierId}); }

      return json(200,{ ok:true, dossier_id:dossierId });
    }

    return json(405,{error:'Methode niet toegestaan.'});
  } catch(e){
    return json(500,{error:String((e&&e.message)||e)});
  }
};
