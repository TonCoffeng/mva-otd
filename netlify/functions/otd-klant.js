// netlify/functions/otd-klant.js
// PUBLIEKE function (geen login) — de klant opent de OTD via een veilige link
// met een token. Het token is de sleutel; zonder geldig token geen toegang.
// GET  ?t=TOKEN -> dossier + opdrachtgever(s) + makelaar (read-only)
// POST ?t=TOKEN {actie:'akkoord'|'opmerking', opmerking} -> reactie vastleggen
const OTD_URL = 'https://oonlagagxodohvakwfat.supabase.co';
const OTD_SERVICE_KEY = process.env.OTD_SERVICE_KEY;
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  try {
    if(!OTD_SERVICE_KEY) return json(500,{error:'Serverconfig ontbreekt.'});
    const otdH = { apikey:OTD_SERVICE_KEY, Authorization:'Bearer '+OTD_SERVICE_KEY };
    const token = ((event.queryStringParameters && event.queryStringParameters.t) || '').trim();
    if(!token) return json(400,{error:'Geen geldige link.'});

    if(event.httpMethod === 'GET'){
      const dRes = await fetch(OTD_URL+'/rest/v1/otd_dossiers?select=*&klant_token=eq.'+encodeURIComponent(token)+'&limit=1',{headers:otdH});
      const dArr = dRes.ok ? await dRes.json() : [];
      const d = dArr[0];
      if(!d) return json(404,{error:'Deze link is niet (meer) geldig.'});

      const ogRes = await fetch(OTD_URL+'/rest/v1/otd_opdrachtgevers?select=voornamen,tussenvoegsels,achternaam,email,telefoon_mobiel,volgorde&dossier_id=eq.'+d.id+'&order=volgorde.asc',{headers:otdH});
      const opdrachtgevers = ogRes.ok ? await ogRes.json() : [];

      let makelaar = null;
      if(d.makelaar_id){
        const mRes = await fetch(OTD_URL+'/rest/v1/otd_makelaars?select=naam,entiteit_naam,email,telefoon&id=eq.'+d.makelaar_id,{headers:otdH});
        const mArr = mRes.ok ? await mRes.json() : [];
        makelaar = mArr[0] || null;
      }
      const rRes = await fetch(OTD_URL+'/rest/v1/otd_regels?select=prijs_snapshot,volgorde,sectie,otd_producten(naam,commerciele_naam)&dossier_id=eq.'+d.id+'&order=volgorde.asc',{headers:otdH});
      const rRows = rRes.ok ? await rRes.json() : [];
      const regels = rRows.map(r=>({
        naam: (r.otd_producten && (r.otd_producten.commerciele_naam || r.otd_producten.naam)) || '',
        prijs: r.prijs_snapshot
      }));
      // alleen de velden die de klant mag zien
      const veilig = {
        documenttype:d.documenttype, object_adres:d.object_adres, object_postcode:d.object_postcode, object_plaats:d.object_plaats,
        bestemming:d.bestemming, in_gebruik_als:d.in_gebruik_als, bouwvorm:d.bouwvorm, soort_object:d.soort_object, vraagprijs:d.vraagprijs,
        courtage_type:d.courtage_type, courtage_pct_incl:d.courtage_pct_incl, courtage_vast_bedrag:d.courtage_vast_bedrag,
        datum_opdracht:d.datum_opdracht, looptijd:d.looptijd, bijzonderheden:d.bijzonderheden,
        status:d.status, klant_reactie:d.klant_reactie
      };
      return json(200,{ dossier:veilig, opdrachtgevers, makelaar, regels });
    }

    if(event.httpMethod === 'POST'){
      const body = JSON.parse(event.body||'{}');
      const actie = body.actie;
      const base = { gereageerd_op: new Date().toISOString() };
      let patch;
      if(actie === 'opmerking'){
        patch = Object.assign({}, base, { status:'concept', klant_reactie: 'OPMERKING: ' + String(body.opmerking||'').slice(0,2000) });
      } else if(actie === 'akkoord'){
        patch = Object.assign({}, base, { klant_reactie: 'AKKOORD — klaar voor ondertekening' });
      } else {
        return json(400,{error:'Onbekende actie.'});
      }
      const r = await fetch(OTD_URL+'/rest/v1/otd_dossiers?klant_token=eq.'+encodeURIComponent(token),{method:'PATCH',headers:Object.assign({},otdH,{'Content-Type':'application/json',Prefer:'return=minimal'}),body:JSON.stringify(patch)});
      if(!r.ok){ const t=await r.text(); return json(500,{error:'Kon reactie niet opslaan ('+r.status+'): '+t}); }
      return json(200,{ ok:true, actie });
    }

    return json(405,{error:'Methode niet toegestaan.'});
  } catch(e){ return json(500,{error:String((e&&e.message)||e)}); }
};
