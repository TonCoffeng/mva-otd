// netlify/functions/otd-pdf.js
// Genereert de OTD als PDF op basis van een klant-token (?t=TOKEN).
// Publiek (token = sleutel), net als otd-klant. Geeft application/pdf terug.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
// Tweetalige juridische bepalingen (VBO-verkoop-OTD), inline zodat ze altijd meekomen.
const BEPALINGEN_VERKOOP = [{"s": "tekst", "nl": "Op deze Opdracht zijn van toepassing de Algemene Consumentenvoorwaarden Makelaardij (hierna: Algemene Consumentenvoorwaarden). Deze voorwaarden zijn tot stand gekomen in overleg met de NVM, Vastgoed Nederland, Vereniging Eigen Huis en de Consumentenbond in het kader van de Coördinatiegroep Zelfreguleringsoverleg van de Sociaal-Economische Raad. Ze zijn in werking getreden op 1 september 2018. Indien in deze Opdracht wordt afgeweken van de voornoemde Algemene Consumentenvoorwaarden dan prevaleert hetgeen is bepaald in deze Opdracht.", "en": "This Instruction is governed by the \"Algemene Consumentenvoorwaarden Makelaardij\", the General Brokerage Terms and Conditions for Consumers (hereafter referred to as: General Terms and Conditions for Consumers). These terms and conditions were effected in consultation with the NVM, Vereniging Vastgoed Nederland, Vereniging Eigen Huis and the Consumentenbond within the framework of the Self-Regulation Coordination Group of the Social and Economic Council. They took effect on 1 September 2018. In case this Instruction differs from the aforementioned General Terms and Conditions for Consumers, the provisions in this Instruction will prevail."}, {"s": "tekst", "nl": "Verder is van toepassing de Beroeps- en Gedragscode van Vereniging Vastgoed Nederland alsmede de klachten- en tuchtregeling. Vereniging Vastgoed Nederland heeft haar klachteninstituut en tuchtrechtspraak ondergebracht bij de Geschillencommissie, www.degeschillencommissie.nl/klachtenloket-vastgoedprofessionals.", "en": "Also applicable are the Professional Code and the Code of Conduct of Vereniging Vastgoed Nederland and the Regulations on Disciplinary Proceedings of the Geschillencommissie (SGC) https://www.degeschillencommissie.nl/over-ons/commissies/tuchtcommissie-vastgoedprofessionals/"}, {"s": "kop", "nl": "De dienstverlening", "en": "The services"}, {"s": "tekst", "nl": "De Makelaar levert voor het uitvoeren van de Opdracht de volledige dienstverlening zoals bedoeld in artikelen 7.3. en 7.4. van de Algemene Consumentenvoorwaarden, met uitzondering van de volgende werkzaamheden:", "en": "To carry out the Instruction, the Estate Agent will provide all services as referred to in Articles 7.3. and 7.4. of the General Terms and Conditions for Consumers with the exception  of the following activities:"}, {"s": "lijst", "nl": "het uitvoeren van de benodigde promotionele activiteiten en het verzorgen van het benodigde promotiemateriaal", "en": "performing the necessary promotional activities and arranging the necessary promotional material"}, {"s": "lijst", "nl": "informatie verzamelen en opvragen over juridische, fiscale, bouwkundige en andere van belang zijnde aspecten betreffende het Object en hierover zo nodig informeren", "en": "collecting and requesting information on legal, tax, structural and other relevant aspects regarding the Object and, where necessary, providing information on the aforementioned aspects"}, {"s": "lijst", "nl": "het helpen bij het verkrijgen van een energielabel of energieprestatiecertificaat", "en": "assisting with acquiring an energy label or energy performance certificate"}, {"s": "lijst", "nl": "het verzorgen en begeleiden van bezichtigingen", "en": "organising and supervising viewings"}, {"s": "lijst", "nl": "advies geven over en het opstellen van de koopovereenkomst", "en": "providing advice on and, if necessary, drawing up the purchase agreement"}, {"s": "lijst", "nl": "het begeleiden bij de afwikkeling van de koop", "en": "supervising finalisation of the purchase"}, {"s": "tekst", "nl": "geen uitzonderingen", "en": "no exceptions"}, {"s": "kop", "nl": "De kosten en courtage", "en": "Costs and commission"}, {"s": "tekst", "nl": "De Opdrachtgever verplicht zich tot het betalen van een vergoeding bestaande uit kosten en courtage voor de geleverde diensten. De kosten en de courtage zijn als volgt opgebouwd:", "en": "The Client is obliged to pay a fee for the services provided, consisting of costs and commission. The costs and commission comprise the following elements:"}, {"s": "kop", "nl": "De Opdracht", "en": "The Instruction"}, {"s": "tekst", "nl": "De Opdracht loopt voor onbepaalde tijd. Beëindiging geschiedt overeenkomstig artikel 14 van de Algemene Consumentenvoorwaarden.", "en": "The Instruction is granted for an indefinite period of time. Termination occurs in accordance with Article 14 of the General Terms and Conditions for Consumers."}, {"s": "tekst", "nl": "Uitdrukkelijk zij vermeld dat deze opdracht tot bemiddeling geen last en volmacht inhoudt om namens Opdrachtgever een overeenkomst van verkoop te sluiten.", "en": "It should be stated explicitly that this Instruction to act as intermediary does not constitute an order and authorisation to conclude a contract of sale on behalf of the Client."}, {"s": "tekst", "nl": "De Opdrachtgever onthoudt zich van het verstrekken van opdrachten aan anderen dan de Makelaar en voert ook zelf geen onderhandelingen, doet geen toezeggingen buiten de Makelaar om en brengt geen koop- en of huurovereenkomsten met betrekking tot het Object  tot stand buiten de Makelaar om. Indien de Opdrachtgever hiermee in strijd handelt is hij van rechtswege, zonder dat een aanmaning nodig is, de volledige courtage verschuldigd.", "en": "The Client will refrain from providing instructions to others than the Estate Agent and will not conduct any negotiations, make promises without involving the Estate Agent or effect purchase or tenancy agreements or contracts of sale in respect of the Object without involving the Estate Agent. If the Client acts contrary to this provision, they will, by operation of law and without demand being required, owe full commission."}, {"s": "tekst", "nl": "Indien na beëindiging van deze Opdracht het resultaat van deze bemiddelingsovereenkomst toch wordt bereikt en de totstandkoming van de koopovereenkomst mede het gevolg is van de dienstverlening van de Makelaar, is de Opdrachtgever in afwijking van artikel 19 van de Algemene Consumentenvoorwaarden de volledige courtage verschuldigd.", "en": "If the result of this Instruction to act as intermediary is achieved after termination of this Instruction and formation of the contract of sale is in part a result of services provided by the Estate Agent, the Client will, notwithstanding Article 19 of the General Terms and Conditions for Consumers, owe full commission."}, {"s": "tekst", "nl": "Indien de Opdrachtgever de Opdracht beëindigt voordat de Opdracht is vervuld, is hij een bedrag verschuldigd dat evenredig is aan het gedeelte van de verbintenis dat door de Makelaar is nagekomen op het moment van uitoefening van het hiervoor bedoelde recht, vergeleken met de volledige nakoming van de verbintenis. Daarnaast worden de opstartkosten en eventuele aanvullende diensten, voor zover deze kosten zijn gemaakt, in rekening gebracht. De hierna gespecificeerde kosten en courtage moeten door de Makelaar, op verzoek van de Opdrachtgever, worden aangetoond.", "en": "If the Client terminates the Instruction before it has been performed, they will owe an amount proportional to the part of the obligation fulfilled by the Estate Agent at the time the aforementioned right is exercised, as compared to complete fulfilment of the obligation. Start-up costs and costs for any additional services, in so far as these have been incurred, will also be charged. The Estate Agent must, upon the Client's request, demonstrate the costs and commission specified below."}, {"s": "tekst", "nl": "De totale kosten zoals onder artikel 2, lid a en c vermeld voor zover deze daadwerkelijk zijn gemaakt", "en": "The total costs as set out in Article 2, paragraphs a and c, in so far as actually incurred."}, {"s": "tekst", "nl": "Werkzaamheden per bezichtiging met een maximum van 10% van de in deze opdracht beoogde courtage", "en": "Activities per viewing, with a maximum of 10% of the commission intended in this Instruction"}, {"s": "kop", "nl": "Wettelijke bedenktijd (EU-richtlijn Consumentenrechten 2014)", "en": "Statutory cooling-off period (EU Consumer Rights Directive 2014)"}, {"s": "tekst", "nl": "Wanneer de Opdracht betrekking heeft op dienstverlening ten aanzien van voor bewoning bestemde ruimte, is op deze opdracht tot bemiddeling:", "en": "If the Instruction concerns services in relation to space intended for residence, the following applies:"}, {"s": "tekst", "nl": "1. Geen bedenktijd van toepassing, indien de Opdracht tot stand is gekomen op het kantoor van de Makelaar. De Makelaar heeft dan toch de informatieplicht van de Richtlijn Consumentenrechten correct en volledig toegepast.", "en": "1. No reflection applies to this Instruction if the Instruction was effected at the Estate Agent's office. In that case, the Estate Agent will have fulfilled the information obligation under the Consumer rights directive correctly and in full."}, {"s": "tekst", "nl": "2. Veertien dagen bedenktijd na ondertekening van toepassing, indien de Opdracht op een andere wijze tot stand is gekomen dan op het kantoor van de Makelaar. Eveneens heeft de Makelaar de informatieplicht van de Richtlijn Consumentenrechten correct en volledig toegepast.", "en": "2. A reflection period of fourteen days after signing applies if the Instruction was effected in any other way than at the Estate Agent's office. Moreover, the Estate Agent must fulfil the information obligation under the Consumer rights directive correctly and in full."}, {"s": "tekst", "nl": "Ingeval de Makelaar de Opdrachtgever niet heeft geïnformeerd over de bedenktijd, wordt deze verlengd tot maximaal één jaar na de totstandkoming van de Opdracht. Ontvangt de Opdrachtgever deze informatie op een later moment alsnog van de Makelaar, dan geldt de bedenktijd van veertien dagen vanaf dat moment.", "en": "If the Estate Agent has failed to inform the Client about the reflection period, it will be extended to up to one year after the Instruction was effected. If the Client receives this information from the Estate Agent at a later point in time, the reflection period of 14 days will start at that later time."}, {"s": "tekst", "nl": "Als de Opdrachtgever gebruik wil maken van zijn recht op herroeping van de Opdracht, meldt hij dit binnen de bedenktijd met de gestelde termijn van veertien kalenderdagen door middel van een expliciete schriftelijke of elektronische mededeling aan de Makelaar. Na ontvangst van deze mededeling stuurt de Makelaar onverwijld een ontvangstbevestiging.", "en": "If the Client wishes to use the right to revoke the Instruction, they will report this to the Estate Agent within the 14-day reflection period by means of a written or digital notification. The Estate Agent will send a confirmation immediately after receiving this notification."}, {"s": "tekst", "nl": "Indien de Opdrachtgever gebruik maakt van de bedenktijd, kan de Makelaar slechts de tot dan toe daadwerkelijk gemaakte kosten in rekening brengen bij Opdrachtgever. De Opdrachtgever is tevens een redelijke vergoeding (loon) verschuldigd voor de door de Makelaar tot het moment van intrekking verrichte werkzaamheden.", "en": "If the Client exercises their right to the reflection period, the Estate Agent can only charge the Client the actual costs incurred until that time. The Client will also owe a reasonable remuneration (salary) for the work performed by the Estate Agent until the time of revocation."}, {"s": "tekst", "nl": "De bewijslast voor de juiste en tijdige uitoefening van het recht op de bedenktijd ligt bij de Opdrachtgever.", "en": "The burden of proof in respect of the correct and timely exercise of the right to the reflection period rests with the Client."}, {"s": "kop", "nl": "De uitvoering", "en": "Performance"}, {"s": "tekst", "nl": "De “Vragenlijst voor de verkoop van een onroerende zaak” (hierna: Vragenlijst) maakt als bijlage onderdeel uit van deze “Opdracht tot bemiddeling bij verkoop woning”. In deze Vragenlijst geeft de Opdrachtgever informatie en legt hij verklaringen af aangaande het te verkopen Object, die voor de Makelaar nodig zijn voor de uitvoering van de Opdracht tot Bemiddeling. De Opdrachtgever verklaart deze informatie en verklaringen naar beste weten en waarheid te hebben verstrekt.", "en": "The “Questionnaire for the sale of immovable property” (hereafter referred to as: Questionnaire) is part of this “Instruction to act as intermediary for selling a dwelling” as an appendix. In this Questionnaire, the Client provides information and makes statements about the Object to be sold which the Estate Agent requires to perform the Instruction to act as intermediary. The Client declares that they have provided this information and these statements to the best of their knowledge and truthfully."}, {"s": "tekst", "nl": "De vraagprijs is: {VRAAGPRIJS}.", "en": "The asking price is: {VRAAGPRIJS}."}, {"s": "tekst", "nl": "De Opdrachtgever stemt ermee in dat de Makelaar een aanbieding van het Object, eventueel met foto’s, tekeningen en dergelijke, ter kennis brengt van collega’s en derden, en dat deze gegevens worden opgenomen in etalages, gidsen en andere overzichten alsmede voor de Makelaar en/of derden (publiekelijk) toegankelijke websites.", "en": "The Client agrees that the Estate Agent offers the Object to colleagues and third parties, if necessary with photographs, drawings and suchlike, and that this information is included in shop windows, guides and other overviews as well as on websites that are (publicly) accessible to the Estate Agent and/or third parties."}, {"s": "tekst", "nl": "De Makelaar zal de door de Opdrachtgever verstrekte informatie en verklaringen aan kandidaat-kopers melden.", "en": "The Estate Agent will report the information and statements provided by the Client to potential buyers."}, {"s": "tekst", "nl": "De Opdrachtgever stelt aan de Makelaar eigendomsbewijzen of afschriften van andere documenten betreffende het Registergoed ter hand.", "en": "The Client will hand over to the Estate Agent proof of ownership or copies of other documents in relation to the Registered Property."}, {"s": "tekst", "nl": "De Opdrachtgever geeft de Makelaar een definitief energielabel. Het energielabel wordt  gebruikt in de uitingen zoals bedoeld in lid e.", "en": "The Client will give the Estate Agent a definitive energy label. The energy label will be used for purposes as referred to under e."}, {"s": "tekst", "nl": "De Makelaar zal vóór het passeren van de akte van levering het concept van deze akte en de nota van afrekening op juistheid controleren. De Opdrachtgever stemt ermee in dat de betrokken notaris voor het verlijden van de akte van levering aan de Makelaar deze documenten ter inzage verstrekt en indien de Opdrachtgever op dat moment nog kosten en/of courtage verschuldigd is deze bij het passeren van de akte van levering worden verrekend.", "en": "Before executing the deed of transfer of title, the Estate Agent will check the correctness of both this deed and the completion statement. The Client agrees that the civil-law notary engaged provides these documents to the Estate Agent for inspection before execution of the deed of transfer of title. If the Client still owes costs and/or commission at that time, these will be settled when the deed of transfer is executed."}, {"s": "kop", "nl": "Privacy en Overige bepalingen", "en": "Privacy and other provisions"}, {"s": "tekst", "nl": "De Opdrachtgever verklaart dat alle aan de Makelaar verstrekte informatie (met inbegrip van de Vragenlijst) die nodig is voor het uitvoeren van de Opdracht correct en volledig is. De Makelaar is niet aansprakelijk voor de gevolgen van niet correct en niet volledig verstrekte informatie. Indien de Opdrachtgever deze informatie heeft verstrekt, terwijl hij wist of had moeten weten dat dit in strijd is met de waarheid (en hij dus te kwader trouw is) dan kan hij aansprakelijk zijn voor alle door de Makelaar als gevolg hiervan geleden of te lijden schade.", "en": "The Client declares that all information provided to the Estate Agent necessary for performance of the Instruction (including the Questionnaire) is correct and complete. The Estate Agent is not liable for the consequences of incorrect or incomplete information. If the Client has provided this information while they knew or should have known that this was inconsistent with the truth (and thereby acting in bad faith), they may be liable for all damage incurred or to be incurred by the Estate Agent as a result."}, {"s": "tekst", "nl": "Alle in deze overeenkomst genoemde kosten en courtage zijn inclusief 21% btw.", "en": "All costs and commissions referred to in this agreement are inclusive of 21% VAT."}, {"s": "tekst", "nl": "De Makelaar is verwerkingsverantwoordelijke in de zin van de Algemene verordening gegevensbescherming. De in deze Opdracht opgenomen persoonsgegevens worden verwerkt voor het uitvoeren van de Opdracht.", "en": "The Estate Agent is processor within the meaning of the General Data Protection Regulation. The personal data included in this Instruction will be processed for performance of the Instruction."}, {"s": "tekst", "nl": "De Makelaar kan (een deel van) de persoonsgegevens in kader van de Opdracht delen met andere verwerkingsverantwoordelijken, zoals een notaris of taxateur.☐ Ja, de Opdrachtgever geeft hiervoor toestemming (door de Opdrachtgever aan te kruisen).", "en": "Within the framework of the Instruction, the Estate Agent may share (part of) the personal data with other processors, such as a civil-law notary or valuer.☐ Yes, the Client gives permission (to be ticked by the Client)."}, {"s": "tekst", "nl": "De Opdrachtgever gaat ermee akkoord dat zijn persoonsgegevens eventueel met derde instellingen zoals bedoeld in de Wwft worden gedeeld in het kader van het uitbesteden van het cliëntenonderzoek.", "en": "The Client agrees that their personal data can be shared with third parties as referred to in the Anti-Money Laundering and Anti-Terrorist Financing Act as part of the outsourcing of the customer due diligence."}, {"s": "tekst", "nl": "Aanvullende bepalingen: {AANVULLEND}", "en": "Additional provisions: {AANVULLEND}"}, {"s": "tekst", "nl": "De Opdrachtgever verklaart de Algemene Consumentenvoorwaarden te hebben ontvangen en daarvan kennis te hebben genomen. Ook is de Opdrachtgever gewezen op de Privacyverklaring van de Makelaar.", "en": "The Client declares that they have received and have taken note of the General Terms and Conditions for Consumers. The Client has also been notified of the Estate Agent's Privacy Statement."}];
const OTD_URL = 'https://oonlagagxodohvakwfat.supabase.co';
const OTD_SERVICE_KEY = process.env.OTD_SERVICE_KEY;

function datumNL(s){ if(!s) return ''; const m=String(s).match(/(\d{4})-(\d{2})-(\d{2})/); return m? m[3]+'-'+m[2]+'-'+m[1] : s; }
function courtageTekst(d){
  const eN = n => '\u20AC '+Number(n||0).toLocaleString('nl-NL');
  const heeftMp = d.courtage_meerprijs_waarde!=null && Number(d.courtage_meerprijs_waarde)>0;
  const drempel = (d.courtage_meerprijs_drempel!=null && Number(d.courtage_meerprijs_drempel)>0)
      ? Number(d.courtage_meerprijs_drempel)
      : (d.vraagprijs!=null && d.vraagprijs!=='' ? Number(d.vraagprijs) : 0);
  const dTxt = drempel ? eN(drempel) : 'de basis';
  const delen = [];
  if(d.courtage_pct_incl!=null && Number(d.courtage_pct_incl)>0)
    delen.push(String(d.courtage_pct_incl).replace('.',',')+'% '+(heeftMp?('over het deel tot '+dTxt):'van de verkoopprijs'));
  if(d.courtage_vast_bedrag!=null && Number(d.courtage_vast_bedrag)>0)
    delen.push('een vast bedrag van '+eN(d.courtage_vast_bedrag));
  if(heeftMp){
    if(d.courtage_meerprijs_type==='vast_bedrag')
      delen.push('een vast bedrag van '+eN(d.courtage_meerprijs_waarde)+' bij verkoop boven '+dTxt);
    else
      delen.push(String(d.courtage_meerprijs_waarde).replace('.',',')+'% over het deel boven '+dTxt);
  }
  if(!delen.length) return 'nader te bepalen';
  return 'De courtage bedraagt '+delen.join(' plus ')+', inclusief btw.';
}

async function genereerOtdPdf({ dossier, opdrachtgevers, makelaar, regels }){
  const d = dossier||{}, ogs = opdrachtgevers||[], m = makelaar||{}, rgs = regels||[];
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy=rgb(0.106,0.165,0.290), oranje=rgb(0.918,0.345,0.047), grijs=rgb(0.39,0.45,0.55), zwart=rgb(0.12,0.16,0.25);
  let page = doc.addPage([595.28,841.89]);
  const M=56, W=595.28-M*2; let y=786;
  const tw = (d.taal==='nl_en');                       // tweetalig NL + Engels
  const ENV = {
    'Bestaande bouw':'Existing construction','Nieuwbouw':'New construction','NVT':'N/A',
    'Woonhuis':'House','Appartement':'Apartment','Woning met bedrijfsruimte':'House with business premises',
    'Parkeerplaats / garagebox':'Parking / garage','Bedrijfspand / kantoor':'Commercial premises / office','Bouwgrond':'Building plot',
    'Wonen':'Residential','Bedrijfsmatig':'Commercial','Gemengd (wonen + bedrijf)':'Mixed (residential + commercial)','Anders':'Other',
    'Eigen bewoning':'Owner-occupied','Verhuurd':'Let','Leegstaand':'Vacant','onbepaalde tijd':'indefinite term'
  };
  const _CP = '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178';
  const _reSafe = new RegExp('[^\\x00-\\xFF'+_CP+']','g');
  const safe = s => String(s==null?'':s).replace(/[\u2610\u2611\u2612\u25A1]/g,'[ ]').replace(_reSafe,'');
  const euro = n => (n==null||n==='') ? '—' : '€ ' + Number(n).toLocaleString('nl-NL');
  const txt = (s,x,yy,o={}) => page.drawText(safe(s),{x,y:yy,size:o.size||10.5,font:o.bold?bold:font,color:o.color||zwart});
  const Vw = (val)=>{ if(val==null||val==='') return '—'; const s=String(val); return (tw && ENV[s]) ? (s+' / '+ENV[s]) : s; };
  const labX = tw ? M+210 : M+170;
  function nieuw(minY){ if(y<minY){ page=doc.addPage([595.28,841.89]); y=786; } }
  function sectie(nl,en){ nieuw(120); txt((tw&&en)?(nl.toUpperCase()+'  /  '+en.toUpperCase()):nl.toUpperCase(),M,y,{bold:true,size:9.5,color:oranje}); y-=17; }
  function rij(k_nl,v,k_en){ nieuw(90); txt((tw&&k_en)?(k_nl+' / '+k_en):k_nl,M,y,{size:tw?9:10.5,color:grijs}); txt(v==null?'—':String(v),labX,y,{size:10.5,bold:true}); y-=17; }
  function wrap(s,maxW){ const woorden=safe(s).split(/\s+/); let line=''; const size=10;
    woorden.forEach(w=>{ const t=line?line+' '+w:w; if(font.widthOfTextAtSize(t,size)>maxW){ nieuw(90); txt(line,M,y,{size}); y-=15; line=w; } else line=t; });
    if(line){ nieuw(90); txt(line,M,y,{size}); y-=15; } }

  txt('MAKELAARSVAN AMSTERDAM',M,y,{bold:true,size:13,color:navy}); y-=26;
  const titelNL = (d.documenttype==='aankoop')?'Opdracht tot dienstverlening — aankoop':'Opdracht tot dienstverlening — verkoop';
  const titelEN = (d.documenttype==='aankoop')?'Instruction to act as intermediary — purchase':'Instruction to act as intermediary — sale';
  txt(titelNL,M,y,{bold:true,size:tw?14:16,color:navy}); y-=tw?15:16;
  if(tw){ txt(titelEN,M,y,{size:10.5,color:grijs}); y-=14; }
  txt((m.entiteit_naam||'MakelaarsVan Amsterdam')+(d.datum_opdracht?('   ·   '+datumNL(d.datum_opdracht)):''),M,y,{size:9.5,color:grijs}); y-=22;
  page.drawLine({start:{x:M,y},end:{x:M+W,y},thickness:1,color:rgb(0.9,0.92,0.95)}); y-=24;

  sectie('Object','Property');
  rij('Adres',[d.object_adres,[d.object_postcode,d.object_plaats].filter(Boolean).join(' ')].filter(Boolean).join(', '),'Address');
  if(d.bouwvorm) rij('Bouwvorm',Vw(d.bouwvorm),'Construction');
  if(d.soort_object) rij('Soort object',Vw(d.soort_object),'Property type');
  rij('Bestemming',Vw(d.bestemming),'Designated use'); rij('In gebruik als',Vw(d.in_gebruik_als),'Current use'); rij('Vraagprijs',euro(d.vraagprijs),'Asking price'); y-=8;

  sectie('Opdrachtgever'+(ogs.length>1?'s':''), ogs.length>1?'Clients':'Client');
  if(ogs.length){ ogs.forEach(o=>{ const naam=[o.voornamen,o.tussenvoegsels,o.achternaam].filter(Boolean).join(' ')||'—'; rij(naam,[o.email,o.telefoon_mobiel].filter(Boolean).join('  ·  ')); }); } else rij('—','');
  y-=8;

  sectie('Courtage & voorwaarden','Fee & terms');
  txt(tw?'Courtage / Fee':'Courtage', M, y, {size:tw?9:10.5, color:grijs}); y-=15;
  wrap(courtageTekst(d), W);
  y-=3;
  rij('Looptijd',Vw(d.looptijd||'onbepaalde tijd'),'Term'); y-=8;
  if(d.bijzonderheden){ sectie('Bijzonderheden','Additional details'); wrap(d.bijzonderheden,W); y-=8; }

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
    sectie('Woningpromotieplan','Marketing plan');
    let totaal=0;
    rgs.forEach(r=>{ const nm=(r.naam||'—'); const pr=Number(r.prijs_snapshot||0); totaal+=pr; prijsRij(nm, pr); });
    nieuw(90); page.drawLine({start:{x:M+W-170,y:y+9},end:{x:M+W,y:y+9},thickness:0.8,color:rgb(0.8,0.83,0.88)}); y-=2;
    prijsRij(tw?'Totaal / Total':'Totaal', totaal, {bold:true}); y-=8;
  }

  // Volledige juridische bepalingen (NL; bij nl_en ook Engels) uit de VBO-verkoop-OTD
  if(BEPALINGEN_VERKOOP && BEPALINGEN_VERKOOP.length){
    const vraagprijs = euro(d.vraagprijs);
    const merge = (s,en)=> String(s).replace(/\{VRAAGPRIJS\}/g, vraagprijs).replace(/\{AANVULLEND\}/g, d.bijzonderheden ? String(d.bijzonderheden) : (en?'none':'geen'));
    const bepTekst = (s,opt={})=>{ const size=opt.size||9.5, fnt=opt.bold?bold:font, kleur=opt.color||zwart, indent=opt.indent||0;
      const woorden=safe(s).split(/\s+/); let line='';
      woorden.forEach(w=>{ const t=line?line+' '+w:w; if(fnt.widthOfTextAtSize(t,size)>(W-indent)){ nieuw(80); txt(line,M+indent,y,{size,bold:opt.bold,color:kleur}); y-=size+3.2; line=w; } else line=t; });
      if(line){ nieuw(80); txt(line,M+indent,y,{size,bold:opt.bold,color:kleur}); y-=size+3.2; } };
    nieuw(150); y-=16; page.drawLine({start:{x:M,y},end:{x:M+W,y},thickness:1,color:rgb(0.9,0.92,0.95)}); y-=20;
    txt(tw?'ALGEMENE BEPALINGEN  /  GENERAL PROVISIONS':'ALGEMENE BEPALINGEN',M,y,{bold:true,size:11,color:navy}); y-=18;
    BEPALINGEN_VERKOOP.forEach(b=>{
      const n=merge(b.nl,false), e=merge(b.en,true);
      if(b.s==='kop'){ y-=7; nieuw(95); bepTekst(n,{bold:true,size:10,color:oranje}); if(tw) bepTekst(e,{bold:true,size:9,color:grijs}); y-=3; }
      else if(b.s==='lijst'){ bepTekst('•  '+n,{size:9.5,indent:10}); if(tw) bepTekst('•  '+e,{size:9,color:grijs,indent:10}); y-=2; }
      else { bepTekst(n,{size:9.5}); if(tw) bepTekst(e,{size:9,color:grijs}); y-=5; }
    });
  }

  nieuw(150); y-=18; page.drawLine({start:{x:M,y},end:{x:M+W,y},thickness:1,color:rgb(0.9,0.92,0.95)}); y-=22;
  txt('Door digitale ondertekening verklaart opdrachtgever akkoord te gaan met bovenstaande opdracht tot dienstverlening.',M,y,{size:9,color:grijs}); y-=(tw?14:40);
  if(tw){ txt('By signing digitally, the client agrees to the instruction to act as intermediary set out above.',M,y,{size:9,color:grijs}); y-=26; }
  txt(tw?'Handtekening opdrachtgever / Signature:':'Handtekening opdrachtgever:',M,y,{size:10}); page.drawLine({start:{x:M+(tw?220:160),y:y-2},end:{x:M+(tw?420:360),y:y-2},thickness:0.8,color:grijs});

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
