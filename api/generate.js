export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prospect, subject, company, meetingType, token, dev } = req.body;
  if (!prospect || !subject) return res.status(400).json({ error: 'Missing fields' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();

  // --- Bypass de test : ignore toutes les limites si la clé dev correspond ---
  const isDev = dev && process.env.DEV_KEY && dev === process.env.DEV_KEY;

  // --- SI TOKEN : vérifier les crédits ---
  if (!isDev && token) {
    try {
      const tokenRes = await fetch(`${supabaseUrl}/rest/v1/tokens?token=eq.${token}&select=token,email,credits_remaining,reset_at`, {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
      });
      const tokenData = await tokenRes.json();

      if (!tokenData || tokenData.length === 0) {
        return res.status(403).json({ error: 'invalid_token' });
      }

      const record = tokenData[0];
      const now = new Date();
      const resetAt = new Date(record.reset_at);

      if (now > resetAt) {
        await fetch(`${supabaseUrl}/rest/v1/tokens?token=eq.${token}`, {
          method: 'PATCH',
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ credits_remaining: 5, credits_used: 0, reset_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() })
        });
        record.credits_remaining = 5;
      }

      if (record.credits_remaining <= 0) {
        return res.status(429).json({ error: 'no_credits', reset_at: record.reset_at });
      }

      await fetch(`${supabaseUrl}/rest/v1/tokens?token=eq.${token}`, {
        method: 'PATCH',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ credits_remaining: record.credits_remaining - 1, credits_used: (record.credits_used || 0) + 1, last_used_at: now.toISOString() })
      });

    } catch (e) {
      // Si erreur Supabase, on continue quand même
    }
  } else if (!isDev) {
    // --- SANS TOKEN : rate limit par IP (1 par 48h) ---
    try {
      const rlRes = await fetch(`${supabaseUrl}/rest/v1/rate_limits?ip=eq.${encodeURIComponent(ip)}&select=count,last_reset`, {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
      });
      const rlData = await rlRes.json();

      if (rlData && rlData.length > 0) {
        const lastReset = new Date(rlData[0].last_reset);
        const hoursSince = (new Date() - lastReset) / (1000 * 60 * 60);
        if (hoursSince < 48 && rlData[0].count >= 1) {
          return res.status(429).json({ error: 'rate_limit', hours_remaining: Math.ceil(48 - hoursSince) });
        }
      }

      await fetch(`${supabaseUrl}/rest/v1/rate_limits`, {
        method: 'POST',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ ip, count: 1, last_reset: new Date().toISOString() })
      });
    } catch (e) {}
  }

  // --- Enregistrer la recherche ---
  try {
    await fetch(`${supabaseUrl}/rest/v1/searches`, {
      method: 'POST',
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, prospect, subject, has_token: !!token, created_at: new Date().toISOString() })
    });
  } catch (e) {}

  // --- Contexte entrée ---
  const companyLine = company
    ? `- Entreprise du prospect : ${company}. Utilise le web pour trouver son actualité réelle et récente (levée, recrutements, lancement, résultats, dirigeants). Sers-t'en pour personnaliser l'accroche et les questions.`
    : `- Entreprise du prospect : non précisée. Base-toi sur le secteur le plus probable pour ce profil, sans inventer de faits sur une entreprise nommée.`;
  const meetingLine = meetingType
    ? `- Type de réunion : ${meetingType}. Adapte les questions et les contre-arguments à ce moment précis du cycle de vente.`
    : `- Type de réunion : premier rendez-vous de découverte.`;

  // --- Prompt ---
  const prompt = `Tu es un analyste de veille commerciale B2B au service d'un commercial français qui prépare une réunion. Ton rôle : lui donner des munitions concrètes, chiffrées et vraies, qu'il peut dire ou faire en réunion.

Tu parles AU commercial, en le tutoyant. Chaque phrase est une chose qu'il peut utiliser, pas une observation générale.

Contexte de la réunion :
- Profil du prospect : ${prospect}
${companyLine}
- Sujet de la réunion : ${subject}
${meetingLine}

Méthode obligatoire :
1. Utilise l'outil de recherche web pour trouver des faits réels, récents et datés : entreprises nommées, chiffres, taux d'adoption, études. Si une entreprise est précisée, cherche AUSSI son actualité propre. Ne jamais inventer un chiffre ni une source.
2. Chaque chiffre affiché vient d'une source réelle et vérifiable, citée avec sa date. Sources à privilégier : Bloomberg, Gartner, McKinsey, Harvard Business Review, WSJ, Financial Times, BLS, Forrester, IDC.
3. Adapte les questions et les contre-arguments au type de réunion indiqué.

Équilibre géographique, important :
- Le décalage US et les jauges sont ta signature, ils parlent assumément des États-Unis.
- L'accroche, les questions et les objections parlent D'ABORD du prospect et de sa réalité française. Le prospect et son entreprise passent avant la géographie. Tu n'invoques les États-Unis dans ces trois blocs que si ça ajoute vraiment quelque chose. Ne répète pas "aux US" dans chaque bloc, ce serait lourd.

Règles de style strictes :
- Phrases courtes, 20 mots maximum.
- Zéro tiret cadratin, zéro tiret demi-cadratin.
- Zéro opposition rhétorique construite du type "ne cherche pas X mais Y".
- Zéro emoji.
- Concret et chiffré. Si tu n'as pas de chiffre sourcé, écris une phrase sans chiffre plutôt qu'un chiffre inventé.

Réponds UNIQUEMENT avec ce JSON, rien avant, rien après :
{
  "score": 72,
  "accroche": {
    "text": "Une seule phrase que le commercial peut lâcher en ouverture pour prouver qu'il connaît le monde du prospect. Ancrée sur la réalité du prospect ou de son entreprise. Un signal US seulement s'il renforce vraiment.",
    "source": "Source réelle datée"
  },
  "questions": [
    "Question de découverte fine, adaptée au type de réunion, qui révèle une douleur et prouve que tu piges leur secteur.",
    "Question numéro 2.",
    "Question numéro 3."
  ],
  "decalage": {
    "text": "Ce qui se passe déjà aux États-Unis sur ce sujet et qui touchera la France dans 12 à 18 mois. Faits et entreprises réels. Mets l'accent sur ce qui arrive bientôt en France. Max 2 phrases.",
    "source": "Source réelle datée"
  },
  "objections": [
    {
      "name": "L'objection la plus probable de ce profil, formulée comme il la dira.",
      "counter": "Ta réponse chiffrée et sourcée pour la désamorcer. Max 2 phrases.",
      "score": 73,
      "source": "HBR · 2026"
    },
    {
      "name": "Deuxième objection probable.",
      "counter": "Ta contre.",
      "score": 58,
      "source": "WSJ · 2026"
    },
    {
      "name": "Troisième objection probable.",
      "counter": "Ta contre.",
      "score": 44,
      "source": "Forrester · 2026"
    }
  ],
  "chiffre": {
    "value": "23%",
    "text": "La statistique unique à lâcher en réunion pour faire lever un sourcil. Ce que le chiffre veut dire pour ce prospect.",
    "source": "Bloomberg · 2026"
  },
  "jauges": [
    {
      "label": "Adoption chez les décideurs équivalents",
      "us": 68,
      "fr": 12,
      "source": "IDC · 2026"
    },
    {
      "label": "Maturité du sujet sur le marché",
      "us": 74,
      "fr": 20,
      "source": "Gartner · 2026"
    }
  ],
  "maturite": 64
}

Toutes les valeurs "us" et "fr" des jauges sont des pourcentages entre 0 et 100. "score" et "maturite" aussi. Les "score" des objections sont la probabilité que le prospect sorte cette objection, entre 0 et 100.`;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      return res.status(500).json({ error: 'anthropic_error', detail: err });
    }

    const anthropicData = await anthropicRes.json();

    // Avec web search, la réponse contient plusieurs blocs. On récupère tout le texte.
    const textParts = (anthropicData.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text);
    const text = textParts.join('\n').trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else return res.status(500).json({ error: 'parse_error', raw: text.slice(0, 500) });
    }

    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
}
