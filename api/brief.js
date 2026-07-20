// api/brief.js  ·  Fonction serverless Vercel (Node)
// Vérifie les jetons, appelle Anthropic, sauvegarde le brief, renvoie tout.
// Env requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_ANON_KEY, ANTHROPIC_API_KEY
//              ANTHROPIC_MODEL (optionnel, sinon 'claude-sonnet-5')

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

async function getUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return r.json();
}
async function getProfile(uid) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${uid}&select=*`, { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } });
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}
async function patchTokens(uid, expected, newLeft, resetAt) {
  let url = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${uid}`;
  if (expected !== null) url += `&tokens_left=eq.${expected}`;
  const body = { tokens_left: newLeft };
  if (resetAt) body.reset_at = resetAt;
  const r = await fetch(url, { method: 'PATCH', headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body) });
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}
async function createProfile(uid, resetAt) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, { method: 'POST', headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ user_id: uid, plan: 'free', tokens_left: 5, tokens_month: 5, reset_at: resetAt }) });
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}
async function saveBrief(uid, input, brief) {
  const row = {
    user_id: uid,
    entreprise: brief.entreprise || input.entreprise || null,
    poste: input.poste || null,
    offre: input.offre || null,
    contexte: input.contexte || null,
    maturite: brief.maturite_score ?? null,
    label: brief.maturite_label || null,
    ouverture: brief.ouverture || null,
    questions: brief.questions || [],
    objection: brief.objection || {},
    chiffre: brief.chiffre || {},
    next_step: brief.next_step || null,
    statut: 'a_relancer'
  };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/briefs`, { method: 'POST', headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(row) });
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function nextMonday(from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 7);
  return d.toISOString();
}

const SYSTEM = `Tu es Faro, un copilote de vente pour rendez-vous B2B en France.
Tu prépares le premier rendez-vous d'un commercial avec un prospect.
Tu écris dans une voix directe et humaine : phrases courtes, vingt mots maximum, faits posés sans emballage.
Règles absolues : aucun tiret cadratin, aucun emoji, aucune liste à puces dans les textes, pas de structure corporate, pas d'opposition rhétorique artificielle.
Tu t'appuies sur les méthodes qui gagnent (SPIN, MEDDIC, Chris Voss), sur de la donnée crédible, et sur l'avance du marché US.
L'ouverture accroche le contexte réel du prospect et se dit telle quelle en réunion.
Les trois questions suivent la logique SPIN et incluent la question du décideur.
L'objection est la plus probable, avec une riposte qui débloque vraiment.
Le chiffre est une donnée sectorielle plausible et défendable, attribuée à une source crédible (Gartner, McKinsey, Forrester, HBR, Bloomberg).
Le next step est concret et sans friction. Tu remplis l'outil, rien d'autre.`;

const TOOL = {
  name: 'rediger_brief',
  description: 'Rédige le brief de rendez-vous structuré.',
  input_schema: {
    type: 'object',
    properties: {
      entreprise: { type: 'string' },
      maturite_score: { type: 'integer', description: '0 à 100' },
      maturite_label: { type: 'string' },
      ouverture: { type: 'string' },
      questions: { type: 'array', items: { type: 'string' } },
      objection: { type: 'object', properties: { texte: { type: 'string' }, riposte: { type: 'string' }, source: { type: 'string' } }, required: ['texte', 'riposte'] },
      chiffre: { type: 'object', properties: { valeur: { type: 'string' }, phrase: { type: 'string' }, source: { type: 'string' } }, required: ['valeur', 'phrase', 'source'] },
      next_step: { type: 'string' }
    },
    required: ['entreprise', 'maturite_score', 'maturite_label', 'ouverture', 'questions', 'objection', 'chiffre', 'next_step']
  }
};

async function generateBrief(input) {
  const profil = input.profil ? `\nProfil du commercial (à utiliser pour affiner l'angle) : ${input.profil}` : '';
  const userMsg = `Prospect à préparer.
Entreprise : ${input.entreprise || 'non précisé'}
Interlocuteur : ${input.poste || 'non précisé'}
Ce que je vends : ${input.offre || 'non précisé'}
Contexte et signaux : ${input.contexte || 'aucun'}${profil}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: SYSTEM, tools: [TOOL], tool_choice: { type: 'tool', name: 'rediger_brief' }, messages: [{ role: 'user', content: userMsg }] })
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Anthropic ${r.status}: ${t.slice(0, 300)}`); }
  const data = await r.json();
  const block = (data.content || []).find(b => b.type === 'tool_use');
  if (!block || !block.input) throw new Error('Réponse illisible');
  return block.input;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Non connecté' });
    const user = await getUser(token);
    if (!user || !user.id) return res.status(401).json({ error: 'Session invalide' });
    const uid = user.id;

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (!body.entreprise && !body.offre) return res.status(400).json({ error: 'Décris au moins l entreprise et ton offre.' });

    let profile = await getProfile(uid);
    if (!profile) profile = await createProfile(uid, nextMonday());
    if (!profile) return res.status(500).json({ error: 'Profil introuvable' });

    const now = new Date();
    let available = profile.tokens_left;
    let resetAt = profile.reset_at;
    if (resetAt && new Date(resetAt) <= now) {
      const quota = profile.tokens_month || 5;
      resetAt = nextMonday(now);
      await patchTokens(uid, null, quota, resetAt);
      available = quota;
    }
    if (available <= 0) return res.status(402).json({ error: 'Plus de jetons cette semaine.', tokens_left: 0, reset_at: resetAt });

    let reserved = null, expected = available;
    for (let i = 0; i < 3 && !reserved; i++) {
      reserved = await patchTokens(uid, expected, expected - 1, null);
      if (!reserved) { const fresh = await getProfile(uid); expected = fresh ? fresh.tokens_left : 0; if (expected <= 0) break; }
    }
    if (!reserved) return res.status(402).json({ error: 'Plus de jetons cette semaine.', tokens_left: 0, reset_at: resetAt });
    const tokensLeft = reserved.tokens_left;

    let brief;
    try { brief = await generateBrief(body); }
    catch (e) { await patchTokens(uid, tokensLeft, tokensLeft + 1, null); return res.status(502).json({ error: 'La génération a échoué. Ton jeton n a pas été consommé.' }); }

    let saved = null;
    try { saved = await saveBrief(uid, body, brief); } catch (e) { saved = null; }

    const out = { ...brief, id: saved ? saved.id : null, statut: saved ? saved.statut : 'a_relancer', created_at: saved ? saved.created_at : new Date().toISOString(), poste: body.poste || null };
    return res.status(200).json({ brief: out, tokens_left: tokensLeft, reset_at: resetAt });
  } catch (e) {
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}
