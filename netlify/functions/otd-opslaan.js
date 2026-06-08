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
        taal: body.taal==='nl_en' ? 'nl_en' : 'nl',
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

      const bewerkId = body.dossier_id || null;
      let dossierId;
      if (bewerkId) {
        // Bestaand concept bijwerken (geen duplicaat)
        const exRes = await fetch(OTD_URL+'/rest/v1/otd_dossiers?select=id,makelaar_id,status&id=eq.'+encodeURIComponent(bewerkId)+'&limit=1',{headers:otdH});
        const exArr = exRes.ok ? await exRes.json() : [];
        const ex = exArr[0];
        if(!ex) return json(404,{error:'Te bewerken dossier niet gevonden.'});
        if(!isDirectie && ex.makelaar_id !== eigenMakelaarId) return json(403,{error:'Geen toegang tot dit dossier.'});
        if(ex.status !== 'concept') return json(409,{error:'Alleen concepten kunnen worden bewerkt.'});
        const upRes = await fetch(OTD_URL+'/rest/v1/otd_dossiers?id=eq.'+encodeURIComponent(bewerkId),{method:'PATCH',headers:Object.assign({},otdH,{Prefer:'return=minimal'}),body:JSON.stringify(dossier)});
        if(!upRes.ok){ const t=await upRes.text(); return json(500,{error:'Bijwerken dossier faalde ('+upRes.status+'): '+t}); }
        // oude opdrachtgevers + regels weghalen — worden hieronder opnieuw geschreven
        await fetch(OTD_URL+'/rest/v1/otd_opdrachtgevers?dossier_id=eq.'+encodeURIComponent(bewerkId),{method:'DELETE',headers:Object.assign({},otdH,{Prefer:'return=minimal'})});
        await fetch(OTD_URL+'/rest/v1/otd_regels?dossier_id=eq.'+encodeURIComponent(bewerkId),{method:'DELETE',headers:Object.assign({},otdH,{Prefer:'return=minimal'})});
        dossierId = bewerkId;
      } else {
        const dRes = await fetch(OTD_URL+'/rest/v1/otd_dossiers',{method:'POST',headers:Object.assign({},otdH,{Prefer:'return=representation'}),body:JSON.stringify(dossier)});
        if(!dRes.ok){ const t=await dRes.text(); return json(500,{error:'Opslaan dossier faalde ('+dRes.status+'): '+t}); }
        const dRows = await dRes.json();
        dossierId = dRows[0] && dRows[0].id;
        if(!dossierId) return json(500,{error:'Geen dossier-id terug.'});
      }

      let ogLijst = Array.isArray(body.opdrachtgevers) ? body.opdrachtgevers
                  : (body.opdrachtgever ? [body.opdrachtgever] : []);
      ogLijst = ogLijst.filter(o=>o && (o.voornamen || o.achternaam || o.email));
      if(ogLijst.length){
        const ogRows = ogLijst.map((og,i)=>({
          dossier_id: dossierId,
          volgorde: i+1,
          type: 'particulier',
          voornamen: og.voornamen || null,
          achternaam: og.achternaam || null,
          email: og.email || null,
          telefoon_mobiel: og.telefoon || null,
          geboorteplaats: og.geboorteplaats || null,
          geboortedatum: parseNLDate(og.geboortedatum)
        }));
        const ogRes = await fetch(OTD_URL+'/rest/v1/otd_opdrachtgevers',{method:'POST',headers:otdH,body:JSON.stringify(ogRows)});
        if(!ogRes.ok){ const t=await ogRes.text(); return json(500,{error:'Dossier opgeslagen, opdrachtgever(s) faalde ('+ogRes.status+'): '+t, dossier_id:dossierId}); }
      }

      // regels (woningpromotieplan) — prijssnapshot server-side uit de catalogus
      const prodIds = Array.isArray(body.producten) ? body.producten.filter(Boolean) : [];
      if(prodIds.length){
        const inList = prodIds.map(encodeURIComponent).join(',');
        const pRes = await fetch(OTD_URL+'/rest/v1/otd_producten?select=id,prijs_incl_btw,categorie&id=in.('+inList+')',{headers:otdH});
        const pArr = pRes.ok ? await pRes.json() : [];
        const pMap = Object.fromEntries(pArr.map(p=>[p.id,p]));
        const regels = prodIds
          .filter(id=>pMap[id])
          .map((id,i)=>({ dossier_id:dossierId, product_id:id, prijs_snapshot:pMap[id].prijs_incl_btw, sectie:pMap[id].categorie, volgorde:i }));
        if(regels.length){
          const rRes = await fetch(OTD_URL+'/rest/v1/otd_regels',{method:'POST',headers:otdH,body:JSON.stringify(regels)});
          if(!rRes.ok){ const t=await rRes.text(); return json(500,{error:'Dossier opgeslagen, regels faalden ('+rRes.status+'): '+t, dossier_id:dossierId}); }
        }
      }

      return json(200,{ ok:true, dossier_id:dossierId, bewerkt:!!bewerkId });
    }

    return json(405,{error:'Methode niet toegestaan.'});
  } catch(e){
    return json(500,{error:String((e&&e.message)||e)});
  }
};
