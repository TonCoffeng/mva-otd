// netlify/functions/otd-signhost-webhook.js
// Publieke postback-ontvanger voor Signhost. Signhost POST't hier de
// transactie-status. Status 30 = ondertekend -> dossier op 'ondertekend' zetten.
// At-least-once: kan meerdere keren binnenkomen; idempotent afgehandeld.
const OTD_URL = 'https://oonlagagxodohvakwfat.supabase.co';
const OTD_SERVICE_KEY = process.env.OTD_SERVICE_KEY;
const ok = (obj) => ({ statusCode:200, headers:{'Content-Type':'application/json'}, body:JSON.stringify(obj||{ok:true}) });

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
    const dRes = await fetch(OTD_URL+'/rest/v1/otd_dossiers?select=id,status&signhost_transaction_id=eq.'+encodeURIComponent(trxId)+'&limit=1',{headers:otdH});
    const dArr = dRes.ok ? await dRes.json() : [];
    const d = dArr[0];
    if(!d) return ok({ ignored:'onbekende transactie' });

    // status 30 = Signed
    if(Number(status) === 30 && d.status !== 'ondertekend'){
      await fetch(OTD_URL+'/rest/v1/otd_dossiers?id=eq.'+encodeURIComponent(d.id), {
        method:'PATCH',
        headers: Object.assign({}, otdH, { 'Content-Type':'application/json', Prefer:'return=minimal' }),
        body: JSON.stringify({ status:'ondertekend', ondertekend_op: new Date().toISOString() })
      });
      return ok({ updated:'ondertekend', dossier:d.id });
    }

    return ok({ ontvangen:true, status });
  } catch(e){ return ok({ error:String((e&&e.message)||e) }); }
};
