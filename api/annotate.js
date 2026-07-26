// api/annotate.js · Le brief vivant : annotations + débrief + synthèse
// Env : SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_ANON_KEY, ANTHROPIC_API_KEY, ANTHROPIC_MODEL (opt)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const H = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' };

async function getUser(t){ const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:ANON_KEY,Authorization:`Bearer ${t}`}}); return r.ok?r.json():null; }
async function getBrief(uid,id){ const r=await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}&user_id=eq.${uid}&select=*`,{headers:H}); const j=await r.json(); return Array.isArray(j)&&j.length?j[0]:null; }
async function patchBrief(uid,id,patch){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}&user_id=eq.${uid}`,{method:'PATCH',headers:{...H,Prefer:'return=representation'},body:JSON.stringify(patch)});
  const j=await r.json(); return Array.isArray(j)&&j.length?j[0]:null;
}

const SYSTEM = `Tu es Faro, copilote de vente B2B. Un commercial sort d'un rendez-vous. Il a annoté son brief pendant l'échange. Tu lis tout et tu en tires l'essentiel.

RÈGLES D'ÉCRITURE : phrases courtes, vingt mots maximum. Aucun tiret cadratin, aucun emoji, aucune puce. Tutoiement. Direct.

TON TRAVAIL :
- observations : deux à quatre constats tirés des annotations. Des faits captés, pas des conseils creux. Exemples de forme : "Le vrai décideur est le DG, pas le DAF." "L'objection réelle est la bande passante interne, pas le prix."
- relance_angle : une phrase qui dit sur quel angle précis appuyer dans la relance, ancrée sur un élément noté pendant le rendez-vous.
Si les annotations sont vides ou pauvres, dis-le honnêtement dans une seule observation et propose un angle générique fondé sur le brief.`;

const TOOL = {
  name:'synthese_rdv',
  description:'Synthèse post rendez-vous.',
  input_schema:{ type:'object', properties:{
    observations:{type:'array',items:{type:'string'},description:'2 à 4 constats courts'},
    relance_angle:{type:'string'}
  }, required:['observations','relance_angle'] }
};

function annTexte(a){
  if(!a) return 'Aucune annotation.';
  const L=[];
  if(a.ouverture&&a.ouverture.note) L.push(`Ouverture, ce qui s'est passé : ${a.ouverture.note}`);
  Object.keys(a).filter(k=>/^q\d+$/.test(k)).forEach(k=>{
    const q=a[k]; if(!q) return;
    const tag=q.tag==='worked'?' (la question a marché)':q.tag==='dodged'?' (question esquivée)':'';
    if(q.note||tag) L.push(`Question ${+k.slice(1)+1}${tag} : ${q.note||'pas de note'}`);
  });
  if(a.objection&&a.objection.note) L.push(`Objection, ce qui s'est vraiment passé : ${a.objection.note}`);
  if(a.chiffre&&a.chiffre.note) L.push(`Réaction au chiffre : ${a.chiffre.note}`);
  if(Array.isArray(a.libre)&&a.libre.length) L.push('Notes libres : '+a.libre.map(n=>n.t).filter(Boolean).join(' | '));
  return L.length?L.join('\n'):'Aucune annotation.';
}

async function synthese(brief,ann,deb){
  const ou=brief.ouverture||''; const ob=brief.objection||{}; const ch=brief.chiffre||{};
  const msg=`BRIEF PRÉPARÉ AVANT LE RENDEZ-VOUS
Entreprise : ${brief.entreprise||''}
Interlocuteur : ${brief.poste||''}
Ouverture prévue : ${typeof ou==='string'?ou:JSON.stringify(ou)}
Questions prévues : ${(brief.questions||[]).map(q=>typeof q==='string'?q:q.question).join(' | ')}
Objection prévue : ${ob.texte||''}
Chiffre prévu : ${(ch.valeur||'')+' '+(ch.phrase||'')}

ANNOTATIONS PRISES PENDANT LE RENDEZ-VOUS
${annTexte(ann)}

DÉBRIEF DU COMMERCIAL
Température : ${deb.temperature==='close'?'closé, le deal est signé':deb.temperature||''}
Prochaine action : ${deb.next_action||''}
${deb.phrase?`À retenir : ${deb.phrase}`:''}`;

  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
    headers:{'x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},
    body:JSON.stringify({model:MODEL,max_tokens:700,system:SYSTEM,tools:[TOOL],tool_choice:{type:'tool',name:'synthese_rdv'},messages:[{role:'user',content:msg}]})});
  if(!r.ok) throw new Error('anthropic');
  const d=await r.json();
  const b=(d.content||[]).find(x=>x.type==='tool_use');
  if(!b||!b.input) throw new Error('illisible');
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
    const {action,id}=body;
    if(!id) return res.status(400).json({error:'Brief manquant.'});

    // Sauvegarde des annotations en direct, pendant le rendez-vous
    if(action==='annotations'){
      const ann=body.annotations||{};
      const patch={annotations:ann};
      if(body.started&&!body.already_started) patch.rdv_started_at=new Date().toISOString();
      const b=await patchBrief(uid,id,patch);
      if(!b) return res.status(404).json({error:'Brief introuvable.'});
      return res.status(200).json({ok:true});
    }

    // Débrief : clôture du rendez-vous, synthèse, statut
    if(action==='debrief'){
      const deb=body.debrief||{};
      if(!deb.temperature) return res.status(400).json({error:'Indique la température du deal.'});
      const brief=await getBrief(uid,id);
      if(!brief) return res.status(404).json({error:'Brief introuvable.'});
      const ann=body.annotations||brief.annotations||{};

      let syn=null;
      try{ syn=await synthese(brief,ann,deb); }catch(e){ syn=null; }

      const statut = deb.temperature==='close' ? 'gagne' : deb.temperature==='mort' ? 'perdu' : 'a_relancer';
      const patch={ annotations:ann, debrief:deb, synthese_post:syn, statut, rdv_ended_at:new Date().toISOString() };
      const saved=await patchBrief(uid,id,patch);
      if(!saved) return res.status(500).json({error:'Sauvegarde impossible.'});
      return res.status(200).json({ok:true,brief:saved,synthese:syn,statut});
    }

    return res.status(400).json({error:'Action inconnue.'});
  }catch(e){ return res.status(500).json({error:'Erreur serveur.'}); }
}
