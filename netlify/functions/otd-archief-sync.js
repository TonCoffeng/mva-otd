// netlify/functions/otd-archief-sync.js
// Geplande koppeling WWFT/Finance -> OTD.
// Pakt courtagenota's die BETAALD zijn EN WWFT-akkoord hebben (eigen klant = ja en
// wederpartij = ja), matcht ze op adres met een ONDERTEKENDE, niet-gearchiveerde OTD,
// en archiveert die OTD automatisch. Omkeerbaar via "Terugzetten" in het overzicht.
//
// Vereist env: LEADPOOL_SERVICE_KEY (om de afgeschermde facturen te lezen) + OTD_SERVICE_KEY.
// Inplannen via netlify.toml:  [functions."otd-archief-sync"]  schedule = "*/15 * * * *"

const LEADPOOL_URL = 'https://olfcrzusdkijxroxvsgm.supabase.co';
const LEADPOOL_SERVICE_KEY = process.env.LEADPOOL_SERVICE_KEY;
const OTD_URL = 'https://oonlagagxodohvakwfat.supabase.co';
const OTD_SERVICE_KEY = process.env.OTD_SERVICE_KEY;
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

function parseAdres(straatnr){
  const s = String(straatnr||'').trim().toLowerCase();
  const m = s.match(/^(.*?)(\d+)\s*([a-z]{0,3})\b/);
  if(!m) return { straat:s.replace(/[^a-z0-9]/g,''), nr:'', toev:'' };
  return { straat:m[1].replace(/[^a-z0-9]/g,''), nr:m[2], toev:(m[3]||'').replace(/[^a-z0-9]/g,'') };
}
const norm = s => String(s||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');

function adresMatch(factuurAdres, otdAdres, otdPlaats){
  const fParts = String(factuurAdres||'').split(',');
  const f = parseAdres(fParts[0]||'');
  const fStad = fParts.length>1 ? fParts[fParts.length-1] : '';
  const o = parseAdres(otdAdres||'');
  if(!f.straat || !f.nr || !o.straat || !o.nr) return false;
  if(f.straat !== o.straat || f.nr !== o.nr) return false;
  if(f.toev && o.toev && f.toev !== o.toev) return false;       // toevoeging: alleen blokkeren bij echte botsing
  const fc = norm(fStad), oc = norm(otdPlaats);
  if(fc && oc && fc !== oc) return false;                        // plaats: alleen blokkeren bij echte botsing
  return true;
}

exports.handler = async (event) => {
  try {
    const dry = !!(event && event.queryStringParameters && event.queryStringParameters.dry === '1');
    if(!OTD_SERVICE_KEY) return json(500, { error:'OTD_SERVICE_KEY ontbreekt.' });
    if(!LEADPOOL_SERVICE_KEY) return json(500, { error:'LEADPOOL_SERVICE_KEY ontbreekt — voeg de Leadpool service-key toe aan de OTD-omgeving.' });

    const lpH  = { apikey:LEADPOOL_SERVICE_KEY, Authorization:'Bearer '+LEADPOOL_SERVICE_KEY };
    const otdH = { apikey:OTD_SERVICE_KEY, Authorization:'Bearer '+OTD_SERVICE_KEY };

    // 1) klare courtagenota's: betaald + WWFT-akkoord (eigen klant + wederpartij = ja)
    const fUrl = LEADPOOL_URL + '/rest/v1/facturen?select=adres'
      + '&is_courtagenota=eq.true&betaald=eq.true'
      + '&eigen_klant_status=eq.ja&wederpartij_status=eq.ja';
    const fRes = await fetch(fUrl, { headers: lpH });
    if(!fRes.ok){ const t=await fRes.text(); return json(502, { error:'Facturen lezen mislukt ('+fRes.status+'): '+t.slice(0,200) }); }
    const facturen = (await fRes.json()).filter(f => f.adres && String(f.adres).trim());

    // 2) kandidaten: ondertekende, niet-gearchiveerde OTD's
    const dRes = await fetch(OTD_URL + '/rest/v1/otd_dossiers?select=id,object_adres,object_plaats&status=eq.ondertekend&gearchiveerd=eq.false', { headers: otdH });
    if(!dRes.ok){ const t=await dRes.text(); return json(502, { error:'OTD-dossiers lezen mislukt ('+dRes.status+'): '+t.slice(0,200) }); }
    const dossiers = await dRes.json();

    // 3) matchen
    const teArchiveren = new Set();
    for(const d of dossiers){
      if(facturen.some(f => adresMatch(f.adres, d.object_adres, d.object_plaats))) teArchiveren.add(d.id);
    }

    // 4) archiveren (of bij dry-run alleen tonen)
    const ids = Array.from(teArchiveren);
    if(dry) return json(200, { ok:true, dry_run:true, klare_facturen:facturen.length, kandidaat_otds:dossiers.length, zou_archiveren_aantal:ids.length, zou_archiveren:ids });
    const gearchiveerd = [];
    for(const id of ids){
      const pRes = await fetch(OTD_URL + '/rest/v1/otd_dossiers?id=eq.' + encodeURIComponent(id), {
        method:'PATCH',
        headers: Object.assign({}, otdH, { 'Content-Type':'application/json', Prefer:'return=minimal' }),
        body: JSON.stringify({ gearchiveerd:true, gearchiveerd_op:new Date().toISOString() })
      });
      if(pRes.ok) gearchiveerd.push(id);
    }

    return json(200, { ok:true, klare_facturen:facturen.length, kandidaat_otds:dossiers.length, gearchiveerd_aantal:gearchiveerd.length, gearchiveerd });
  } catch(e){ return json(500, { error:String((e&&e.message)||e) }); }
};
