export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prospect, subject } = req.body;

  if (!prospect || !subject) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Missing API key', debug: 'ANTHROPIC_API_KEY not found' });
  }

  const prompt = `Tu es un expert en veille commerciale B2B, specialise dans les tendances US qui arrivent en France avec 12 a 18 mois de decalage.

Un commercial francais prepare une reunion avec ce profil :
- Prospect : ${prospect}
- Sujet de la reunion : ${subject}

Reponds UNIQUEMENT avec ce JSON, sans texte avant ou apres :
{
  "signals": [
    {
      "title": "Titre court du signal US (max 12 mots)",
      "body": "Ce qui se passe aux US sur ce sujet avec chiffres et entreprises specifiques. Max 2 phrases.",
      "implication": "Ce que ca signifie pour cette reunion. Max 2 phrases.",
      "source": "Bloomberg · Juillet 2026"
    },
    {
      "title": "L objection principale que ce profil va sortir",
      "body": "Pourquoi les decideurs americains equivalents sortent cette objection.",
      "implication": "Comment repondre avec des donnees US. Max 2 phrases.",
      "source": "HBR · Juin 2026"
    },
    {
      "title": "Le benchmark US que ce profil va utiliser",
      "body": "Les chiffres et standards du marche americain que ce prospect connait.",
      "implication": "Comment se positionner par rapport a ce benchmark. Max 2 phrases.",
      "source": "WSJ · Juillet 2026"
    }
  ],
  "retenir": "Une phrase de conclusion percutante sur l enjeu principal."
}`;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return res.status(500).json({ error: 'anthropic_error', detail: errText });
    }

    const data = await anthropicRes.json();
    const text = data.content[0].text.trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch(e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else return res.status(500).json({ error: 'parse_error', raw: text });
    }

    return res.status(200).json(parsed);

  } catch(e) {
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
}
