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
async function saveBrief(uid,input,b){
  const row={ user_id:uid, entreprise:b.entreprise||input.entreprise||null, poste:input.poste||null, offre:input.offre||null,
    contexte:input.contexte||null, maturite:b.maturite_score??null, label:b.maturite_label||null,
    ouverture:[b.ouverture&&b.ouverture.accroche,b.ouverture&&b.ouverture.qui_nous_sommes,b.ouverture&&b.ouverture.pourquoi_vous].filter(Boolean).join(' '),
    questions:b.questions||[], objection:b.objection||{}, chiffre:b.chiffre||{}, next_step:(b.next_step&&b.next_step.phrase)||b.next_step||null, statut:'a_relancer' };
  const r=await fetch(`${SUPABASE_URL}/rest/v1/briefs`,{method:'POST',headers:{...H,Prefer:'return=representation'},body:JSON.stringify(row)});
  const j=await r.json(); return Array.isArray(j)&&j.length?j[0]:null;
}
function nextMonday(from=new Date()){ const d=new Date(Date.UTC(from.getUTCFullYear(),from.getUTCMonth(),from.getUTCDate())); const dow=(d.getUTCDay()+6)%7; d.setUTCDate(d.getUTCDate()-dow+7); return d.toISOString(); }

const SYSTEM = `Tu es Faro, copilote de vente pour rendez-vous B2B en France.
Tu prépares un commercial qui va rencontrer un prospect. Tu écris ce qu'il doit DIRE, pas ce qu'il doit faire.

VOIX : phrases courtes, vingt mots maximum. Direct, humain, sans emballage.
INTERDITS ABSOLUS : aucun tiret cadratin, aucun emoji, aucune puce dans les textes, aucune formule corporate, aucune opposition rhétorique artificielle du type "ne cherchez pas X mais Y".

TOUT SE PRONONCE. Jamais "aborder la question du budget", toujours la phrase exacte à dire.

L'OUVERTURE se joue en trois temps, les trente premières secondes du rendez-vous :
1. accroche : remerciement bref qui cadre le temps.
2. qui_nous_sommes : une phrase qui présente l'entreprise du vendeur À TRAVERS le problème que vit ce prospect précis. Jamais une plaquette. Elle change selon l'interlocuteur.
3. pourquoi_vous : le pont vers leur monde, ancré sur un fait réel de leur entreprise.

LES QUESTIONS suivent SPIN : situation, problème, implication. L'une des trois identifie toujours qui décide vraiment.

L'OBJECTION est la plus probable pour CE poste dans CE secteur, avec une riposte qui débloque.

LE CHIFFRE est une donnée sectorielle défendable, attribuée à une source crédible (Gartner, McKinsey, Forrester, HBR, Bloomberg, INSEE).

LES PIÈGES : deux erreurs à ne pas commettre avec ce profil précis. C'est ce qui sauve un rendez-vous.

HONNÊTETÉ : dans faits_verifies tu ne mets QUE ce qui figure dans les données fournies. Dans hypotheses tu mets ce que tu déduis, formulé comme une supposition à vérifier en réunion. Ne présente jamais une déduction comme un fait.`;

const TOOL = {
  name:'rediger_brief', description:'Rédige le brief de rendez-vous.',
  input_schema:{ type:'object', properties:{
    entreprise:{type:'string'},
    faits_verifies:{type:'array',items:{type:'object',properties:{fait:{type:'string'},source:{type:'string'}},required:['fait','source']},description:'3 à 4 faits issus uniquement des données fournies'},
    hypotheses:{type:'array',items:{type:'string'},description:'2 déductions à vérifier en réunion'},
    maturite_score:{type:'integer'}, maturite_label:{type:'string'},
    ouverture:{type:'object',properties:{accroche:{type:'string'},qui_nous_sommes:{type:'string'},pourquoi_vous:{type:'string'}},required:['accroche','qui_nous_sommes','pourquoi_vous']},
    questions:{type:'array',items:{type:'object',properties:{question:{type:'string'},intention:{type:'string'}},required:['question','intention']}},
    objection:{type:'object',properties:{texte:{type:'string'},riposte:{type:'string'},source:{type:'string'}},required:['texte','riposte']},
    chiffre:{type:'object',properties:{valeur:{type:'string'},phrase:{type:'string'},source:{type:'string'}},required:['valeur','phrase','source']},
    pieges:{type:'array',items:{type:'string'}},
    next_step:{type:'object',properties:{phrase:{type:'string'},delai_jours:{type:'integer'}},required:['phrase','delai_jours']}
  }, required:['entreprise','faits_verifies','hypotheses','maturite_score','maturite_label','ouverture','questions','objection','chiffre','pieges','next_step'] }
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

async function generate(input){
  const rdv={premier:'Premier rendez-vous, il ne connaît pas encore l offre.',relance:'Rendez-vous de relance, un premier contact a déjà eu lieu.',negociation:'Négociation finale, le sujet est le prix et les conditions.'}[input.type_rdv]||'Premier rendez-vous.';
  const msg=`DONNÉES OFFICIELLES DE L'ENTREPRISE EN FACE
${bloc(input.entreprise_data)}

INTERLOCUTEUR : ${input.poste||'non précisé'}
TYPE DE RENDEZ-VOUS : ${rdv}

CE QUE VEND LE COMMERCIAL : ${input.offre||'non précisé'}
${input.valeur?`SA PROPOSITION DE VALEUR : ${input.valeur}`:''}
${input.company?`SON ENTREPRISE : ${input.company}`:''}
${input.contexte?`CE QU'IL SAIT EN PLUS : ${input.contexte}`:''}`;

  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
    headers:{'x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},
    body:JSON.stringify({model:MODEL,max_tokens:2200,system:SYSTEM,tools:[TOOL],tool_choice:{type:'tool',name:'rediger_brief'},messages:[{role:'user',content:msg}]})});
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

    let saved=null; try{ saved=await saveBrief(uid,body,brief); }catch(e){}
    const out={...brief,id:saved?saved.id:null,statut:'a_relancer',created_at:saved?saved.created_at:new Date().toISOString(),poste:body.poste||null,entreprise_data:body.entreprise_data||null};
    return res.status(200).json({brief:out,tokens_left:tl,reset_at:resetAt});
  }catch(e){ return res.status(500).json({error:'Erreur serveur.'}); }
}
