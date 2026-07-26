// api/refine.js · Reformuler une section du brief, avec consigne facultative
// Env : SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_ANON_KEY, ANTHROPIC_API_KEY, ANTHROPIC_MODEL (opt)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const H = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' };

async function getUser(t){ const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:ANON_KEY,Authorization:`Bearer ${t}`}}); return r.ok?r.json():null; }
async function getBrief(uid,id){ const r=await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}&user_id=eq.${uid}&select=*`,{headers:H}); const j=await r.json(); return Array.isArray(j)&&j.length?j[0]:null; }
async function patchBrief(uid,id,patch){ const r=await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}&user_id=eq.${uid}`,{method:'PATCH',headers:{...H,Prefer:'return=representation'},body:JSON.stringify(patch)}); const j=await r.json(); return Array.isArray(j)&&j.length?j[0]:null; }

const BASE = `Tu es Faro, copilote de vente B2B en France. Tu reformules UNE section d'un brief de rendez-vous.
RÈGLES : phrases courtes, vingt mots maximum. Aucun tiret cadratin, aucun emoji, aucune puce. Tout se prononce. Tu restes cohérent avec le reste du brief fourni en contexte. Tu n'inventes aucun fait nouveau sur l'entreprise.`;

const SCHEMAS = {
  ouverture:{ props:{accroche:{type:'string'},qui_nous_sommes:{type:'string'},pourquoi_vous:{type:'string'}}, req:['accroche','qui_nous_sommes','pourquoi_vous'], desc:"L'ouverture en trois temps." },
  question:{ props:{question:{type:'string'},intention:{type:'string'}}, req:['question','intention'], desc:'Une question et son intention.' },
  objection:{ props:{texte:{type:'string'},riposte:{type:'string'},source:{type:'string'},source_url:{type:'string'}}, req:['texte','riposte'], desc:"L'objection probable et sa riposte." },
  chiffre:{ props:{valeur:{type:'string'},phrase:{type:'string'},source:{type:'string'},source_url:{type:'string'}}, req:['valeur','phrase','source'], desc:'Le chiffre à lâcher, sourcé.' },
  next_step:{ props:{phrase:{type:'string'},delai_jours:{type:'integer'}}, req:['phrase','delai_jours'], desc:'La proposition de sortie.' }
};

function contexte(b){
  const ob=b.objection||{}, ch=b.chiffre||{};
  return `ENTREPRISE : ${b.entreprise||''}
DONNÉES : ${JSON.stringify(b.entreprise_data||{})}
INTERLOCUTEUR : ${b.poste||''}
OFFRE DU COMMERCIAL : ${b.offre||''}
OUVERTURE ACTUELLE : ${typeof b.ouverture==='string'?b.ouverture:JSON.stringify(b.ouverture||{})}
QUESTIONS ACTUELLES : ${(b.questions||[]).map(q=>typeof q==='string'?q:q.question).join(' | ')}
OBJECTION ACTUELLE : ${ob.texte||''} / riposte : ${ob.riposte||''}
CHIFFRE ACTUEL : ${(ch.valeur||'')+' '+(ch.phrase||'')} (${ch.source||''})
NEXT STEP ACTUEL : ${(b.next_step&&b.next_step.phrase)||b.next_step||''}`;
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
    const {id,section,index,instruction}=body;
    if(!id||!section||!SCHEMAS[section]) return res.status(400).json({error:'Section inconnue.'});

    const brief=await getBrief(uid,id);
    if(!brief) return res.status(404).json({error:'Brief introuvable.'});

    const sc=SCHEMAS[section];
    const tool={name:'reformuler',description:sc.desc,input_schema:{type:'object',properties:sc.props,required:sc.req}};
    let cible='';
    if(section==='question'){
      const q=(brief.questions||[])[index||0];
      cible=`LA QUESTION À REFORMULER (index ${index||0}) : ${typeof q==='string'?q:JSON.stringify(q)}`;
    } else cible=`LA SECTION À REFORMULER : ${section}`;
    const consigne=instruction?`CONSIGNE DU COMMERCIAL : ${instruction}`:'CONSIGNE : propose une version différente et meilleure, même intention.';

    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
      headers:{'x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},
      body:JSON.stringify({model:MODEL,max_tokens:800,system:BASE,tools:[tool],tool_choice:{type:'tool',name:'reformuler'},
        messages:[{role:'user',content:`${contexte(brief)}\n\n${cible}\n${consigne}`}]})});
    if(!r.ok) return res.status(502).json({error:'La reformulation a échoué.'});
    const d=await r.json();
    const out=(d.content||[]).find(x=>x.type==='tool_use');
    if(!out||!out.input) return res.status(502).json({error:'Réponse illisible.'});
    const nv=out.input;

    // Persistance dans la ligne briefs
    const patch={};
    if(section==='ouverture') patch.ouverture=[nv.accroche,nv.qui_nous_sommes,nv.pourquoi_vous].filter(Boolean).join(' ');
    if(section==='question'){ const qs=(brief.questions||[]).slice(); qs[index||0]={question:nv.question,intention:nv.intention}; patch.questions=qs; }
    if(section==='objection') patch.objection={...(brief.objection||{}),...nv};
    if(section==='chiffre') patch.chiffre={...(brief.chiffre||{}),...nv};
    if(section==='next_step') patch.next_step=nv.phrase;
    await patchBrief(uid,id,patch);

    return res.status(200).json({section,index:index??null,content:nv});
  }catch(e){ return res.status(500).json({error:'Erreur serveur.'}); }
}
