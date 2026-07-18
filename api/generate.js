export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prospect, subject, token } = req.body;
  if (!prospect || !subject) return res.status(400).json({ error: 'Missing fields' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();

  // --- SI TOKEN : vérifier les crédits ---
  if (token) {
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

      // Reset hebdomadaire si expiré
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

      // Décrémenter les crédits
      await fetch(`${supabaseUrl}/rest/v1/tokens?token=eq.${token}`, {
        method: 'PATCH',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ credits_remaining: record.credits_remaining - 1, credits_used: (record.credits_used || 0) + 1, last_used_at: now.toISOString() })
      });

    } catch (e) {
      // Si erreur Supabase, on continue quand même
    }
  } else {
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

      // Upsert rate limit
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

  // --- Appel Anthropic ---
  const prompt = `Tu es un expert en veille commerciale B2B, spécialisé dans les tendances US qui arrivent en France avec 12 à 18 mois de décalage.

Un commercial français prépare un premier rendez-vous avec ce profil :
- Prospect : ${prospect}
- Sujet de la réunion : ${subject}

Réponds UNIQUEMENT avec ce JSON, sans texte avant ou après :
{
  "signals": [
    {
      "title": "Titre court et percutant du signal US (max 12 mots)",
      "body": "Ce qui se passe aux US sur ce sujet avec des chiffres et entreprises spécifiques. Max 2 phrases.",
      "implication": "Ce que ça signifie concrètement pour cette réunion. Max 2 phrases.",
      "source": "Bloomberg · Juillet 2026"
    },
    {
      "title": "L'objection principale que ce profil va sortir en réunion",
      "body": "Pourquoi les décideurs américains équivalents sortent cette objection, sur quoi elle est basée.",
      "implication": "Comment répondre avec des données US concrètes. Max 2 phrases.",
      "source": "HBR · Juin 2026"
    },
    {
      "title": "Le benchmark US que ce profil va utiliser pour comparer",
      "body": "Les chiffres et standards du marché américain que ce prospect connaît déjà.",
      "implication": "Comment se positionner par rapport à ce benchmark. Max 2 phrases.",
      "source": "WSJ · Juillet 2026"
    }
  ],
  "retenir": "Une phrase de conclusion percutante sur l'enjeu principal de cette réunion.",
  "score": 72,
  "objections": [
    {"name": "ROI difficile à quantifier", "score": 73},
    {"name": "Budget non prévu", "score": 58},
    {"name": "Résistance interne", "score": 44}
  ],
  "maturite": 68
}`;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      return res.status(500).json({ error: 'anthropic_error', detail: err });
    }

    const anthropicData = await anthropicRes.json();
    const text = anthropicData.content[0].text.trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else return res.status(500).json({ error: 'parse_error' });
    }

    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
}
