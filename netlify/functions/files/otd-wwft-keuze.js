// netlify/functions/otd-wwft-keuze.js
// GET ?id=<zaak_id>&t=<actie_token>&keuze=gestart|monique
// Afhandeling van de knoppen in de Wwft-actiemail aan de makelaar:
//   keuze=gestart → status 'gestart' + gestart_op (klant-herinneringen kunnen gaan lopen)
//   keuze=monique → toegewezen_aan 'monique' + mail aan Monique (verwerking binnen 24 uur)
// Token-beveiligd (uniek per zaak), idempotent: nogmaals klikken kan geen kwaad.
const LEADPOOL_URL = 'https://olfcrzusdkijxroxvsgm.supabase.co';
const LEADPOOL_SERVICE_KEY = process.env.LEADPOOL_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY_OTD || process.env.RESEND_API_KEY;
const MONIQUE_EMAIL = 'moniqueklaver@makelaarsvan.nl';

const pagina = (titel, tekst) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
  body: '<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>' + titel + ' · MVA</title>' +
    '<style>body{font-family:Arial,Helvetica,sans-serif;background:#f6f3ec;color:#27313f;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}' +
    '.k{background:#fff;border:1px solid #e9e3d8;border-radius:14px;padding:34px 36px;max-width:440px;text-align:center}' +
    'h1{font-size:1.25rem;color:#16243f;margin:0 0 10px}p{margin:0;line-height:1.55;color:#5b6472}.b{display:inline-block;width:46px;height:46px;border-radius:50%;background:#fdf1e8;color:#df5a0f;font-size:24px;line-height:46px;margin-bottom:14px}</style></head>' +
    '<body><div class="k"><div class="b">&#10003;</div><h1>' + titel + '</h1><p>' + tekst + '</p></div></body></html>'
});

exports.handler = async (event) => {
  try {
    if (!LEADPOOL_SERVICE_KEY) return pagina('Configuratiefout', 'Neem contact op met de beheerder (LEADPOOL_SERVICE_KEY ontbreekt).');
    const q = event.queryStringParameters || {};
    const id = (q.id || '').trim();
    const token = (q.t || '').trim();
    const keuze = (q.keuze || '').trim();
    if (!id || !token || !['gestart', 'monique'].includes(keuze)) {
      return pagina('Ongeldige link', 'Deze link is niet (meer) geldig.');
    }

    const sbH = { apikey: LEADPOOL_SERVICE_KEY, Authorization: 'Bearer ' + LEADPOOL_SERVICE_KEY };

    // zaak ophalen + token controleren
    const zRes = await fetch(LEADPOOL_URL + '/rest/v1/wwft_zaken?select=id,actie_token,status,toegewezen_aan,object_adres,documenttype,makelaar_naam,makelaar_email,opdrachtgevers,aantal_personen&id=eq.' + encodeURIComponent(id) + '&limit=1', { headers: sbH });
    const zArr = zRes.ok ? await zRes.json() : [];
    const z = zArr[0];
    if (!z || String(z.actie_token) !== token) {
      return pagina('Ongeldige link', 'Deze link is niet (meer) geldig.');
    }

    const obj = z.object_adres || (z.documenttype === 'aankoop' ? 'aankoopbegeleiding' : '—');

    if (z.status === 'afgerond') {
      return pagina('Al afgerond', 'De Wwft-zaak voor ' + obj + ' is al afgerond. Er is niets meer te doen.');
    }

    if (keuze === 'gestart') {
      if (z.status !== 'gestart') {
        await fetch(LEADPOOL_URL + '/rest/v1/wwft_zaken?id=eq.' + encodeURIComponent(id), {
          method: 'PATCH',
          headers: Object.assign({}, sbH, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
          body: JSON.stringify({ status: 'gestart', gestart_op: new Date().toISOString(), bijgewerkt_op: new Date().toISOString() })
        });
      }
      return pagina('Genoteerd: check verstuurd', 'De Wwft-zaak voor <b>' + obj + '</b> staat nu op &ldquo;Gestart&rdquo;. De klant kan de check invullen via Move.nl; jullie horen vanzelf wanneer het is afgerond.');
    }

    // keuze === 'monique'
    if (z.toegewezen_aan !== 'monique') {
      await fetch(LEADPOOL_URL + '/rest/v1/wwft_zaken?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: Object.assign({}, sbH, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({ toegewezen_aan: 'monique', bijgewerkt_op: new Date().toISOString() })
      });
      // mail aan Monique met dezelfde instructie en de ✓-knop
      if (RESEND_API_KEY) {
        const host = (event.headers && event.headers.host) || 'otd-mva.netlify.app';
        const namen = (z.opdrachtgevers || []).map(o => o.naam).filter(Boolean).join(', ') || '—';
        const html =
          '<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:auto;color:#27313f;line-height:1.55">' +
            '<div style="background:#16243f;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;border-bottom:3px solid #df5a0f"><strong style="font-size:14px;letter-spacing:1px">MVA — Wwft-check versturen</strong></div>' +
            '<div style="border:1px solid #e9e3d8;border-top:none;border-radius:0 0 12px 12px;padding:22px;background:#fffdfa">' +
              '<p style="margin:0 0 12px">Beste Monique,</p>' +
              '<p style="margin:0 0 12px"><b>' + (z.makelaar_naam || z.makelaar_email || 'De makelaar') + '</b> heeft de Wwft-check voor <b>' + obj + '</b> aan jou overgedragen (afspraak: verwerken binnen 24 uur).</p>' +
              '<p style="margin:0 0 12px">Opdrachtgever(s): ' + namen + ' (' + (z.aantal_personen || 1) + ' pers.)</p>' +
              '<p style="margin:0 0 12px">Versturen: open in Realworks het object &rarr; relatie &rarr; Move.nl-knop &rarr; <i>Start/Open Wwft Dossier</i> &rarr; <i>Versturen</i>. Klik daarna hieronder.</p>' +
              '<p style="text-align:center;margin:18px 0 6px">' +
                '<a href="https://crm.realworks.nl" style="background:#16243f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;display:inline-block;margin:3px">Naar Realworks</a> ' +
                '<a href="https://' + host + '/.netlify/functions/otd-wwft-keuze?id=' + z.id + '&t=' + z.actie_token + '&keuze=gestart" style="background:#1d7a3f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;display:inline-block;margin:3px">&#10003; Check verstuurd</a>' +
              '</p>' +
            '</div></div>';
        const payload = {
          from: 'MakelaarsVan Amsterdam <noreply@makelaarsvan.nl>',
          to: [MONIQUE_EMAIL],
          subject: 'Wwft-check versturen — ' + obj,
          html: html
        };
        if (z.makelaar_email) payload.reply_to = z.makelaar_email;
        try { await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } catch (e) { /* mailfout toont gewoon de bevestiging */ }
      }
    }
    return pagina('Monique is ingeschakeld', 'De Wwft-zaak voor <b>' + obj + '</b> is aan Monique overgedragen. Zij verstuurt de check binnen 24 uur en jij hoeft verder niets te doen.');
  } catch (e) {
    return pagina('Er ging iets mis', String((e && e.message) || e));
  }
};
