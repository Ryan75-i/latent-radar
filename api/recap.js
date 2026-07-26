// api/recap.js · Le mail de recap post rendez-vous, en trois tons
// Env : SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_ANON_KEY, ANTHROPIC_API_KEY, ANTHROPIC_MODEL (opt)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const H = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' };

async function getUser(t){ const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:ANON_KEY,Authorization:`Bearer ${t}`}}); return r.ok?r.json():null; }
async function getBrief(uid,id){ const r=await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}&user_id=eq.${uid}&select=*`,{headers:H}); const j=await r.json(); return Array.isArray(j)&&j.length?j[0]:null; }
async function getSettings(uid){ const r=await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${uid}&select=*`,{headers:H}); const j=await r.json(); return Array.isArray(j)&&j.length?j[0]:{}; }

const SYSTEM = `Tu rédiges le mail que le commercial envoie à son prospect juste après leur rendez-vous.

RÈGLES ABSOLUES :
- Le mail s'adresse au prospect : vouvoiement obligatoire.
- Phrases courtes, vingt mots maximum. Aucun tiret cadratin, aucun emoji, aucune formule corporate creuse.
- Interdit d'inventer : tu ne cites QUE ce qui figure dans le brief, les annotations et le débrief. Si une information manque, tu n'en parles pas.
- Le mail rappelle un ou deux points PRÉCIS de l'échange (venant des annotations si elles existent), confirme ce qui a été convenu, et se termine sur la prochaine étape.
- Signature : le prénom du commercial et le nom de son entreprise, fournis dans les données. Si absents, termine par une formule simple sans nom.

TROIS VERSIONS DU MÊME MAIL :
- bref : cinq lignes maximum. Merci, un point retenu, la prochaine étape. Sec et pro.
- complet : huit à douze lignes. Merci, les deux ou trois points discutés en prose fluide, ce qui a été convenu, la prochaine étape datée si connue.
- chaleureux : même contenu que bref mais avec un ton plus humain, une touche personnelle si les annotations en donnent une. Jamais obséquieux.

L'objet du mail est court, factuel, sans point d'exclamation. Exemple de forme : "Suite à notre échange" ou "Notre rendez-vous de ce matin".`;

const TOOL = {
  name:'rediger_recap',
  description:'Rédige le mail de recap en trois versions.',
  input_schema:{ type:'object', properties:{
    objet:{type:'string'},
    bref:{type:'string'},
    complet:{type:'string'},
    chaleureux:{type:'string'}
  }, required:['objet','bref','complet','chaleureux'] }
};

function annTexte(a){
  if(!a) return 'Aucune annotation.';
  const L=[];
  if(a.ouverture&&a.ouverture.note) L.push(`Début du rendez-vous : ${a.ouverture.note}`);
  Object.keys(a).filter(k=>/^q\d+$/.test(k)).forEach(k=>{ const q=a[k]; if(q&&q.note) L.push(`Réponse notée : ${q.note}`); });
  if(a.objection&&a.objection.note) L.push(`Objection ou réaction : ${a.objection.note}`);
  if(a.chiffre&&a.chiffre.note) L.push(`Réaction au chiffre : ${a.chiffre.note}`);
  if(Array.isArray(a.libre)) a.libre.forEach(n=>{ if(n.t) L.push(`Note : ${n.t}`); });
  return L.length?L.join('\n'):'Aucune annotation.';
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
    if(!body.id) return res.status(400).json({error:'Brief manquant.'});

    const brief=await getBrief(uid,body.id);
    if(!brief) return res.status(404).json({error:'Brief introuvable.'});
    const set=await getSettings(uid);
    const deb=brief.debrief||{};
    const prenom=(set.full_name||'').trim().split(/\s+/)[0]||'';

    const msg=`ENTREPRISE RENCONTRÉE : ${brief.entreprise||''}
INTERLOCUTEUR : ${brief.poste||''}
CE QUE VEND LE COMMERCIAL : ${brief.offre||set.offre||''}
SON ENTREPRISE : ${set.company||''}
SON PRÉNOM POUR LA SIGNATURE : ${prenom||'non fourni'}

CE QUI ÉTAIT PRÉVU AU BRIEF
Questions posées : ${(brief.questions||[]).map(q=>typeof q==='string'?q:q.question).join(' | ')}
Next step proposé : ${(brief.next_step&&brief.next_step.phrase)||brief.next_step||''}

CE QUI S'EST PASSÉ (annotations prises pendant le rendez-vous)
${annTexte(brief.annotations)}

DÉBRIEF
Température : ${deb.temperature==='close'?'closé, le deal est signé, le mail confirme et remercie':deb.temperature||'non renseignée'}
Prochaine action convenue : ${deb.next_action||'non renseignée'}
${deb.phrase?`À retenir : ${deb.phrase}`:''}
${brief.synthese_post&&brief.synthese_post.relance_angle?`Angle conseillé : ${brief.synthese_post.relance_angle}`:''}`;

    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
      headers:{'x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},
      body:JSON.stringify({model:MODEL,max_tokens:1400,system:SYSTEM,tools:[TOOL],tool_choice:{type:'tool',name:'rediger_recap'},messages:[{role:'user',content:msg}]})});
    if(!r.ok) return res.status(502).json({error:'La rédaction a échoué.'});
    const d=await r.json();
    const b=(d.content||[]).find(x=>x.type==='tool_use');
    if(!b||!b.input) return res.status(502).json({error:'Réponse illisible.'});

    return res.status(200).json({recaps:{objet:b.input.objet,bref:b.input.bref,complet:b.input.complet,chaleureux:b.input.chaleureux}});
  }catch(e){ return res.status(500).json({error:'Erreur serveur.'}); }
}
