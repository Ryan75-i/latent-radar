// api/arene.js · Simulateur de rendez-vous
// Env : SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_ANON_KEY, ANTHROPIC_API_KEY, ANTHROPIC_MODEL (opt)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const H = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' };

async function getUser(t){ const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:ANON_KEY,Authorization:`Bearer ${t}`}}); return r.ok?r.json():null; }
async function getProfile(uid){ const r=await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${uid}&select=*`,{headers:H}); const j=await r.json(); return Array.isArray(j)&&j.length?j[0]:null; }
async function patchTokens(uid,expected,left){
  let url=`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${uid}`;
  if(expected!==null) url+=`&tokens_left=eq.${expected}`;
  const r=await fetch(url,{method:'PATCH',headers:{...H,Prefer:'return=representation'},body:JSON.stringify({tokens_left:left})});
  const j=await r.json(); return Array.isArray(j)&&j.length?j[0]:null;
}
async function getArene(uid,id){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/arenes?id=eq.${id}&user_id=eq.${uid}&select=*`,{headers:H});
  const j=await r.json(); return Array.isArray(j)&&j.length?j[0]:null;
}
async function createArene(uid,adversaire,offre,firstMsg){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/arenes`,{method:'POST',headers:{...H,Prefer:'return=representation'},
    body:JSON.stringify({user_id:uid,adversaire,offre,messages:[{role:'assistant',content:firstMsg}],status:'en_cours',tours:0})});
  const j=await r.json(); return Array.isArray(j)&&j.length?j[0]:null;
}
async function updateArene(uid,id,patch){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/arenes?id=eq.${id}&user_id=eq.${uid}`,{method:'PATCH',headers:{...H,Prefer:'return=representation'},
    body:JSON.stringify({...patch,updated_at:new Date().toISOString()})});
  const j=await r.json(); return Array.isArray(j)&&j.length?j[0]:null;
}

// Trois profils d'adversaires
const ADVERSAIRES = {
  daf_presse: {
    nom:'DAF pressé',
    contexte:'Tu es Camille Roy, Directrice Financière d une PME industrielle française de 200 personnes. Tu as accepté ce rendez-vous par courtoisie, tu as 20 minutes maximum. Tu es fatiguée, tu enchaînes les réunions, ton téléphone vibre en permanence. Tu es analytique, directe, tu veux du concret et des chiffres. Tu supportes mal le discours commercial générique. Tu vas interrompre si on te fait perdre du temps. Tu poses des questions courtes et sèches. Si le vendeur ne cadre pas vite pourquoi tu devrais lui donner cinq minutes de plus, tu écourtes.'
  },
  dsi_mefiant: {
    nom:'DSI méfiant',
    contexte:'Tu es Julien Marchal, DSI d une scale-up française tech de 150 personnes qui vient de lever. Tu as été brûlé par trois éditeurs SaaS ces deux dernières années : promesses non tenues, intégrations qui ont mangé six mois de tes équipes. Tu es sceptique par défaut, tu veux des preuves techniques concrètes. Tu poses beaucoup de questions sur la stack, la sécurité, la conformité SOC2, le RGPD, la souveraineté des données, la roadmap. Tu compares en silence avec ce que tu connais déjà. Tu es poli mais tranchant. Une réponse floue te braque immédiatement.'
  },
  acheteur_prix: {
    nom:'Acheteur qui compare',
    contexte:'Tu es Nadia Fournier, Responsable Achats d un groupe industriel de 800 personnes. Tu as trois devis sur la table pour cette catégorie et ton objectif est simple : obtenir le meilleur prix aux meilleures conditions. Tu ramènes tout au tarif, aux volumes, aux garanties, aux pénalités. Tu joues les concurrents les uns contre les autres. Tu utilises des phrases comme « votre concurrent me propose 20% de moins », « on peut baisser sur le prix ? », « quels engagements vous prenez sur les délais ». Tu ne réagis à aucun argument de valeur avant d avoir obtenu une concession sur le prix.'
  }
};

const SYSTEM_PROSPECT = (adv, offre) => `Tu joues le rôle d'un prospect dans un rendez-vous commercial. Le commercial en face de toi va essayer de te vendre : "${offre||'un service B2B'}".

TON PERSONNAGE :
${adv.contexte}

RÈGLES DE JEU :
- Tu es le prospect, pas le commercial. Tu ne vends pas, tu résistes, tu poses des questions, tu objectes.
- Reste EN CARACTÈRE en permanence. Ne casse jamais le quatrième mur. Ne dis jamais "en tant qu'IA".
- Réponses courtes : maximum trois phrases par tour. Comme un vrai humain qui parle vite.
- Pas de discours, pas de listes, pas de tirets cadratins, pas d'emoji, pas de smileys.
- Reste français, professionnel, exigeant. Tutoie ou vouvoie selon ton personnage : ici vouvoiement par défaut.
- Ta première réplique est ton accueil : brève, dans le ton du personnage, elle donne le cadre.
- Aux tours suivants, réagis PRÉCISÉMENT à ce que le commercial vient de dire. Ne fais pas de discours.
- Si le commercial dit quelque chose de creux ou de générique, montre-le : silence gêné, question qui perce, ou objection sèche.
- Si le commercial dit quelque chose de fort, reconnais-le, mais continue à tester : "d'accord, mais concrètement, pour nous, ça donne quoi ?"
- Tu peux couper court si le commercial est vraiment mauvais : "Écoutez, je pense qu'on n'est pas alignés."`;

const SYSTEM_VERDICT = `Tu es un coach commercial senior qui vient d'observer un entraînement. Tu vas noter la performance du commercial sur trois axes, avec honnêteté et bienveillance.

RÈGLES :
- Notes de 0 à 10 sur chaque axe, avec une phrase courte qui justifie la note.
- Un verdict global en une phrase, qui dit ce qui a été le mieux tenu et ce qui a le plus manqué.
- Deux conseils concrets et actionnables pour la prochaine fois. Pas de généralités.
- Pas de tirets cadratins, pas d'emoji, phrases courtes, ton direct et professionnel.
- Français.`;

const TOOL_VERDICT = {
  name:'noter_entrainement',
  description:'Note la session d entrainement du commercial.',
  input_schema:{
    type:'object',
    properties:{
      decouverte:{type:'object',properties:{note:{type:'integer'},pourquoi:{type:'string'}},required:['note','pourquoi']},
      tenue:{type:'object',properties:{note:{type:'integer'},pourquoi:{type:'string'}},required:['note','pourquoi']},
      closing:{type:'object',properties:{note:{type:'integer'},pourquoi:{type:'string'}},required:['note','pourquoi']},
      verdict:{type:'string'},
      conseils:{type:'array',items:{type:'string'}}
    },
    required:['decouverte','tenue','closing','verdict','conseils']
  }
};

async function anthropic(system, messages, tool){
  const body={model:MODEL,max_tokens:800,system,messages};
  if(tool){ body.tools=[tool]; body.tool_choice={type:'tool',name:tool.name}; }
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
    headers:{'x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok){ const t=await r.text(); throw new Error(`Anthropic ${r.status}: ${t.slice(0,200)}`); }
  const d=await r.json();
  if(tool){ const b=(d.content||[]).find(x=>x.type==='tool_use'); if(!b) throw new Error('Verdict illisible'); return b.input; }
  const b=(d.content||[]).find(x=>x.type==='text'); return b?b.text.trim():'';
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
    const action=body.action;

    // START : nouvelle session (consomme 1 jeton)
    if(action==='start'){
      const advKey=body.adversaire, offre=body.offre||'';
      const adv=ADVERSAIRES[advKey];
      if(!adv) return res.status(400).json({error:'Adversaire inconnu.'});
      if(!offre) return res.status(400).json({error:'Renseigne ton offre avant de lancer une session.'});

      const p=await getProfile(uid);
      if(!p||p.tokens_left<=0) return res.status(402).json({error:'Plus de jetons cette semaine.',tokens_left:0,reset_at:p&&p.reset_at});
      let reserved=null, exp=p.tokens_left;
      for(let i=0;i<3&&!reserved;i++){ reserved=await patchTokens(uid,exp,exp-1); if(!reserved){ const f=await getProfile(uid); exp=f?f.tokens_left:0; if(exp<=0) break; } }
      if(!reserved) return res.status(402).json({error:'Plus de jetons cette semaine.',tokens_left:0});
      const tl=reserved.tokens_left;

      let firstMsg;
      try{ firstMsg=await anthropic(SYSTEM_PROSPECT(adv,offre),[{role:'user',content:'[Le commercial vient d entrer dans la salle. Tu l accueilles maintenant. Une ou deux phrases, dans le ton de ton personnage.]'}]); }
      catch(e){ await patchTokens(uid,tl,tl+1); return res.status(502).json({error:'Ouverture impossible. Ton jeton n a pas été consommé.'}); }

      let arene=null; try{ arene=await createArene(uid,advKey,offre,firstMsg); }catch(e){}
      return res.status(200).json({arene,adversaire:adv.nom,tokens_left:tl});
    }

    // TURN : le commercial répond, le prospect enchaîne (pas de jeton)
    if(action==='turn'){
      const id=body.id, msg=(body.message||'').trim();
      if(!id||!msg) return res.status(400).json({error:'Paramètres manquants.'});
      const a=await getArene(uid,id);
      if(!a||a.status!=='en_cours') return res.status(400).json({error:'Session introuvable ou terminée.'});
      const adv=ADVERSAIRES[a.adversaire]; if(!adv) return res.status(400).json({error:'Adversaire inconnu.'});

      const history=(a.messages||[]).concat([{role:'user',content:msg}]);
      let reply; try{ reply=await anthropic(SYSTEM_PROSPECT(adv,a.offre),history); }
      catch(e){ return res.status(502).json({error:'Le prospect ne répond plus. Réessaie.'}); }
      const updated=history.concat([{role:'assistant',content:reply}]);
      const tours=a.tours+1;
      const patched=await updateArene(uid,id,{messages:updated,tours});
      return res.status(200).json({arene:patched,reply,tours});
    }

    // END : verdict de la session
    if(action==='end'){
      const id=body.id;
      const a=await getArene(uid,id);
      if(!a) return res.status(404).json({error:'Session introuvable.'});
      if(a.status==='termine') return res.status(200).json({arene:a});
      const adv=ADVERSAIRES[a.adversaire];

      const transcript=(a.messages||[]).map(m=>`${m.role==='assistant'?adv.nom:'Commercial'} : ${m.content}`).join('\n\n');
      let verdict; try{ verdict=await anthropic(SYSTEM_VERDICT,[{role:'user',content:`Voici l entrainement à noter.\n\nOffre vendue : ${a.offre}\nAdversaire : ${adv.nom}\n\nTRANSCRIPTION :\n\n${transcript}`}],TOOL_VERDICT); }
      catch(e){ return res.status(502).json({error:'Verdict impossible pour le moment.'}); }

      const patched=await updateArene(uid,id,{verdict,status:'termine'});
      return res.status(200).json({arene:patched,verdict});
    }

    return res.status(400).json({error:'Action inconnue.'});
  }catch(e){ return res.status(500).json({error:'Erreur serveur.'}); }
}
