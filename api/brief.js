// api/brief.js · Génération du brief Faro
// Env : SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_ANON_KEY, ANTHROPIC_API_KEY, ANTHROPIC_MODEL (opt)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const H = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' };

async function getUser(t){ const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:ANON_KEY,Authorization:`Bearer ${t}`}}); return r.ok?r.json():null; }
async function getProfile(uid){ const r=await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${uid}&select=*`,{headers:H}); const j=await r.json(); return Array.isArray(j)&&j.length?j[0]:null; }
async function patchTokens(uid,expected,left,resetAt){
  let url=`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${uid}`; if(expected!==null) url+=`&tokens_left=eq.${expected}`;
  const body={tokens_left:left}; if(resetAt) body.reset_at=resetAt;
  const r=await fetch(url,{method:'PATCH',headers:{...H,Prefer:'return=representation'},body:JSON.stringify(body)});
  const j=await r.json(); return Array.isArray(j)&&j.length?j[0]:null;
}
async function createProfile(uid,resetAt){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/profiles`,{method:'POST',headers:{...H,Prefer:'return=representation'},body:JSON.stringify({user_id:uid,plan:'free',tokens_left:5,tokens_month:5,reset_at:resetAt})});
  const j=await r.json(); return Array.isArray(j)&&j.length?j[0]:null;
}

async function findOrCreateDeal(uid,input){
  const siren=input.entreprise_data&&input.entreprise_data.siren;
  let url=`${SUPABASE_URL}/rest/v1/deals?user_id=eq.${uid}&select=*`;
  url+=siren?`&siren=eq.${siren}`:`&entreprise=eq.${encodeURIComponent(input.entreprise)}`;
  try{
    const r=await fetch(url,{headers:H}); const j=await r.json();
    if(Array.isArray(j)&&j.length){
      const d=j[0];
      const patch={entreprise_data:input.entreprise_data||d.entreprise_data,site:input.site||d.site,interlocuteur:input.poste||d.interlocuteur,updated_at:new Date().toISOString()};
      await fetch(`${SUPABASE_URL}/rest/v1/deals?id=eq.${d.id}`,{method:'PATCH',headers:H,body:JSON.stringify(patch)});
      return {...d,...patch};
    }
    const row={user_id:uid,siren:siren||null,entreprise:input.entreprise,entreprise_data:input.entreprise_data||null,site:input.site||null,etape:'contact',interlocuteur:input.poste||null};
    const c=await fetch(`${SUPABASE_URL}/rest/v1/deals`,{method:'POST',headers:{...H,Prefer:'return=representation'},body:JSON.stringify(row)});
    const cj=await c.json(); return Array.isArray(cj)&&cj.length?cj[0]:null;
  }catch(e){ return null; }
}
async function saveBrief(uid,input,b,dealId){
  const row={
    user_id:uid,
    deal_id:dealId||null,
    entreprise:b.entreprise||input.entreprise||null,
    entreprise_data:input.entreprise_data||null,
    site:input.site||null,
    poste:input.poste||null,
    offre:input.offre||null,
    contexte:input.contexte||null,
    // L'objectif de sortie survit désormais au rechargement
    objectif:input.objectif||null,
    maturite:b.maturite_score??null,
    label:b.maturite_label||null,
    ouverture:[b.ouverture&&b.ouverture.accroche,b.ouverture&&b.ouverture.qui_nous_sommes,b.ouverture&&b.ouverture.pourquoi_vous].filter(Boolean).join(' '),
    questions:b.questions||[],
    objection:b.objection||{},
    chiffre:b.chiffre||{},
    next_step:(b.next_step&&b.next_step.phrase)||b.next_step||null,
    statut:'a_relancer'
  };
  const r=await fetch(`${SUPABASE_URL}/rest/v1/briefs`,{method:'POST',headers:{...H,Prefer:'return=representation'},body:JSON.stringify(row)});
  const j=await r.json(); return Array.isArray(j)&&j.length?j[0]:null;
}
function nextMonday(from=new Date()){ const d=new Date(Date.UTC(from.getUTCFullYear(),from.getUTCMonth(),from.getUTCDate())); const dow=(d.getUTCDay()+6)%7; d.setUTCDate(d.getUTCDate()-dow+7); return d.toISOString(); }

const SYSTEM = `Tu es Faro, copilote de vente pour rendez-vous B2B en France.
Tu prépares un commercial qui va rencontrer un prospect. Tu écris ce qu'il doit DIRE, pas ce qu'il doit faire.

VOIX : phrases courtes, vingt mots maximum. Direct, humain, sans emballage.
INTERDITS ABSOLUS : aucun tiret cadratin, aucun emoji, aucune puce dans les textes, aucune formule corporate, aucune opposition rhétorique artificielle du type "ne cherchez pas X mais Y".

TOUT SE PRONONCE. Jamais "aborder la question du budget", toujours la phrase exacte à dire.

L'OUVERTURE se joue en trois temps :
1. accroche : remerciement bref qui cadre le temps. Si l'interlocuteur est nommé, utilise son prénom.
2. qui_nous_sommes : une phrase qui présente l'entreprise du vendeur À TRAVERS le problème du prospect.
3. pourquoi_vous : le pont vers leur monde, ancré sur un fait réel de leur entreprise.

LES QUESTIONS suivent SPIN : situation, problème, implication. Chaque question a une INTENTION explicitement rédigée (à quoi elle sert, ce qu'elle révèle). L'une des trois identifie toujours qui décide vraiment.

L'OBJECTION est la plus probable pour CE poste dans CE secteur, avec une riposte qui débloque. Si tu cites une source, mets aussi son URL quand tu la connais.

LE CHIFFRE est une donnée sectorielle défendable, attribuée à une source crédible (Gartner, McKinsey, Forrester TEI, HBR, Bloomberg, INSEE, Statista, IDC). Fournis le nom de la source ET son URL si tu la connais.

LES PIÈGES : deux erreurs à ne pas commettre avec ce profil précis.

LA MATURITÉ : score 0 à 100 sur l'ouverture du marché et du prospect. Label court, trois raisons courtes, un verdict d'une phrase.

HONNÊTETÉ : dans faits_verifies tu ne mets QUE ce qui figure dans les données fournies. Dans hypotheses tu mets ce que tu déduis.

LA MANIÈRE DE VENDRE DU COMMERCIAL, quand elle est fournie, est une contrainte, pas une suggestion. Elle prime sur tes habitudes. S'il dit qu'il ne parle jamais prix au premier rendez-vous, aucune phrase du brief ne mentionne le prix. S'il dit qu'il tutoie, tout le brief tutoie.

SES ANGLES MORTS, quand ils sont fournis, sont des corrections à appliquer sans les nommer. Tu ne lui fais jamais la leçon dans le brief : tu compenses silencieusement. S'il oublie souvent de verrouiller la date, la prochaine étape contient une date précise à proposer.`;

const TOOL = {
  name:'rediger_brief', description:'Rédige le brief de rendez-vous.',
  input_schema:{ type:'object', properties:{
    entreprise:{type:'string'},
    faits_verifies:{type:'array',items:{type:'object',properties:{fait:{type:'string'},source:{type:'string'}},required:['fait','source']}},
    hypotheses:{type:'array',items:{type:'string'}},
    maturite_score:{type:'integer'},
    maturite_label:{type:'string'},
    maturite_raisons:{type:'array',items:{type:'string'},description:'3 raisons courtes qui expliquent ce score'},
    maturite_verdict:{type:'string',description:'Une phrase : que faire de ce score'},
    ouverture:{type:'object',properties:{accroche:{type:'string'},qui_nous_sommes:{type:'string'},pourquoi_vous:{type:'string'}},required:['accroche','qui_nous_sommes','pourquoi_vous']},
    ouverture_source:{type:'string',description:'Source du signal cité dans pourquoi_vous, si applicable'},
    questions:{type:'array',items:{type:'object',properties:{question:{type:'string'},intention:{type:'string',description:'Pourquoi cette question, à quoi elle sert'}},required:['question','intention']}},
    objection:{type:'object',properties:{texte:{type:'string'},riposte:{type:'string'},source:{type:'string'},source_url:{type:'string',description:'URL de la source si connue'}},required:['texte','riposte']},
    chiffre:{type:'object',properties:{valeur:{type:'string'},phrase:{type:'string'},source:{type:'string'},source_url:{type:'string',description:'URL de la source si connue'}},required:['valeur','phrase','source']},
    pieges:{type:'array',items:{type:'string'}},
    next_step:{type:'object',properties:{phrase:{type:'string'},delai_jours:{type:'integer'}},required:['phrase','delai_jours']}
  }, required:['entreprise','faits_verifies','hypotheses','maturite_score','maturite_label','maturite_raisons','maturite_verdict','ouverture','questions','objection','chiffre','pieges','next_step'] }
};

function bloc(e){
  if(!e) return 'Aucune donnée officielle récupérée.';
  const l=[];
  if(e.nom) l.push(`Raison sociale : ${e.nom}`);
  if(e.activite) l.push(`Activité : ${e.activite}${e.code_naf?` (NAF ${e.code_naf})`:''}`);
  if(e.effectif) l.push(`Effectif : ${e.effectif}`);
  if(e.taille) l.push(`Taille : ${e.taille}`);
  if(e.annee_creation) l.push(`Créée en ${e.annee_creation}${e.anciennete?` (${e.anciennete} ans)`:''}`);
  if(e.ville) l.push(`Siège : ${e.ville}`);
  if(e.etablissements) l.push(`Établissements ouverts : ${e.etablissements}`);
  if(e.dirigeants&&e.dirigeants.length) l.push(`Dirigeants : ${e.dirigeants.map(d=>d.nom+(d.qualite?` (${d.qualite})`:'')).join(', ')}`);
  if(e.forme_juridique) l.push(`Forme juridique : ${e.forme_juridique}`);
  l.push(`Source de ces données : ${e.source||'INSEE via data.gouv.fr'}`);
  return l.join('\n');
}

// Ce que le parcours a collecté, en paramètres propres plutôt qu'en pavé de texte
const DECLS={
  entrant:"Le prospect a demandé le rendez-vous. Il a donc déjà un besoin exprimé : ne le survends pas, fais-lui préciser ce qu'il cherche.",
  sortant:"Le commercial a décroché ce rendez-vous à froid. Le prospect n'a rien demandé : l'ouverture doit justifier les quinze premières minutes.",
  recommandation:"Le rendez-vous vient d'une recommandation. Nomme-la dans l'accroche, c'est le meilleur capital de départ.",
  salon:"Le contact vient d'un salon ou d'un événement. Rappelle le contexte de la rencontre dans l'accroche.",
  relance:"Le rendez-vous fait suite à une relance du commercial. Le prospect a mis du temps à répondre : ne le lui reproche jamais."
};
const GOALS={
  qualifier:"Qualifier : sortir avec budget, décideur et échéance identifiés. La prochaine étape doit servir cet objectif.",
  rdv2:"Décrocher un deuxième rendez-vous avec la bonne personne. La prochaine étape doit contenir une date précise à proposer.",
  chiffrer:"Obtenir le périmètre exact à chiffrer. La prochaine étape doit verrouiller ce qui entre et ce qui sort du devis.",
  signer:"Faire signer. La prochaine étape doit lever le dernier obstacle et nommer le signataire."
};
const ROOMS={
  seul:"Le commercial sera seul face à un seul interlocuteur.",
  duo:"Ils seront deux en face. Prévois une question qui fasse parler celui qui se taira.",
  comite:"Rendez-vous en comité. L'ouverture doit tenir devant plusieurs métiers à la fois.",
  visio:"Le rendez-vous se tient en visio. Les phrases doivent être plus courtes encore."
};

function contexteRiche(i){
  const l=[];
  if(i.declencheur&&DECLS[i.declencheur]) l.push(`COMMENT CE RENDEZ-VOUS EST NÉ : ${DECLS[i.declencheur]}`);
  if(i.objectif&&GOALS[i.objectif]) l.push(`OBJECTIF DE SORTIE : ${GOALS[i.objectif]}`);
  if(i.room&&ROOMS[i.room]) l.push(`QUI SERA DANS LA PIÈCE : ${ROOMS[i.room]}`);
  if(i.concurrent) l.push(`CONCURRENT DÉJÀ EN PLACE : ${i.concurrent}. Construis la riposte en tenant compte de cette solution existante, sans jamais la dénigrer frontalement.`);
  if(i.echeance) l.push(`ÉCHÉANCE CONNUE CHEZ LE PROSPECT : ${i.echeance}. Sers-t'en pour créer une urgence légitime, jamais artificielle.`);
  if(i.memoire) l.push(`CE QUE LE COMMERCIAL SAIT DÉJÀ DE CE CLIENT, tiré de ses rendez-vous précédents :\n${i.memoire}\nAppuie-toi dessus. Ne repose jamais une question dont la réponse figure ici.`);
  return l.join('\n\n');
}

async function generate(input){
  const rdv={premier:'Premier rendez-vous, il ne connaît pas encore l offre.',relance:'Rendez-vous de relance, un premier contact a déjà eu lieu.',negociation:'Négociation finale, le sujet est le prix et les conditions.'}[input.type_rdv]||'Premier rendez-vous.';
  const riche=contexteRiche(input);
  const msg=`DONNÉES OFFICIELLES DE L'ENTREPRISE EN FACE
${bloc(input.entreprise_data)}

INTERLOCUTEUR : ${input.poste||'non précisé'}${input.interlocuteur_nom?` (nommé : ${input.interlocuteur_nom})`:''}
TYPE DE RENDEZ-VOUS : ${rdv}

CE QUE VEND LE COMMERCIAL : ${input.offre||'non précisé'}
${input.valeur?`SA PROPOSITION DE VALEUR : ${input.valeur}`:''}
${input.company?`SON ENTREPRISE : ${input.company}`:''}
${input.cible?`SA CIBLE TYPE : ${input.cible}`:''}
${input.preuves?`SES PREUVES : ${input.preuves}`:''}
${input.style?`SA MANIÈRE DE VENDRE, à respecter sans exception :\n${input.style}`:''}
${input.angles?`SES ANGLES MORTS, à compenser sans jamais les nommer dans le brief :\n${input.angles}`:''}
${riche?`\n${riche}`:''}
${input.contexte?`\nCE QU'IL SAIT EN PLUS : ${input.contexte}`:''}`;

  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
    headers:{'x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},
    body:JSON.stringify({
      model:MODEL,max_tokens:2400,
      // Le bloc système ne change jamais : on le met en cache
      system:[{type:'text',text:SYSTEM,cache_control:{type:'ephemeral'}}],
      tools:[TOOL],tool_choice:{type:'tool',name:'rediger_brief'},
      messages:[{role:'user',content:msg}]
    })});
  if(!r.ok){ const t=await r.text(); throw new Error(`Anthropic ${r.status}: ${t.slice(0,200)}`); }
  const d=await r.json();
  const b=(d.content||[]).find(x=>x.type==='tool_use');
  if(!b||!b.input) throw new Error('Réponse illisible');
  return b.input;
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Méthode non autorisée'});
  try{
    const token=(req.headers.authorization||'').replace('Bearer ','').trim();
    if(!token) return res.status(401).json({error:'Non connecté'});
    const user=await getUser(token);
    if(!user||!user.id) return res.status(401).json({error:'Session invalide'});
    const uid=user.id;
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    if(!body.entreprise&&!body.offre) return res.status(400).json({error:'Choisis une entreprise et vérifie ton offre.'});

    let p=await getProfile(uid); if(!p) p=await createProfile(uid,nextMonday());
    if(!p) return res.status(500).json({error:'Profil introuvable'});

    const now=new Date(); let left=p.tokens_left, resetAt=p.reset_at;
    if(resetAt&&new Date(resetAt)<=now){ const q=p.tokens_month||5; resetAt=nextMonday(now); await patchTokens(uid,null,q,resetAt); left=q; }
    if(left<=0) return res.status(402).json({error:'Plus de jetons cette semaine.',tokens_left:0,reset_at:resetAt});

    let reserved=null, exp=left;
    for(let i=0;i<3&&!reserved;i++){ reserved=await patchTokens(uid,exp,exp-1,null); if(!reserved){ const f=await getProfile(uid); exp=f?f.tokens_left:0; if(exp<=0) break; } }
    if(!reserved) return res.status(402).json({error:'Plus de jetons cette semaine.',tokens_left:0,reset_at:resetAt});
    const tl=reserved.tokens_left;

    let brief;
    try{ brief=await generate(body); }
    catch(e){ await patchTokens(uid,tl,tl+1,null); return res.status(502).json({error:'La génération a échoué. Ton jeton n a pas été consommé.'}); }

    const deal=await findOrCreateDeal(uid,body);
    let saved=null; try{ saved=await saveBrief(uid,body,brief,deal?deal.id:null); }catch(e){}
    const out={...brief,id:saved?saved.id:null,deal_id:deal?deal.id:null,statut:'a_relancer',created_at:saved?saved.created_at:new Date().toISOString(),poste:body.poste||null,objectif:body.objectif||null,entreprise_data:body.entreprise_data||null,site:body.site||null};
    return res.status(200).json({brief:out,deal:deal||null,tokens_left:tl,reset_at:resetAt});
  }catch(e){ return res.status(500).json({error:'Erreur serveur.'}); }
}
