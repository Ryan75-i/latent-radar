export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const body = await req.json();
    const prospect = body.prospect || '';
    const subject = body.subject || '';

    if (!prospect || !subject) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
    }

    const prompt = `Tu es un expert en veille commerciale B2B, specialise dans les tendances US qui arrivent en France avec 12 a 18 mois de decalage.

Un commercial francais prepare une reunion avec ce profil :
- Prospect : ${prospect}
- Sujet de la reunion : ${subject}

Genere un brief de veille commerciale. Reponds UNIQUEMENT avec ce JSON exact, sans texte avant ou apres :
{
  "signals": [
    {
      "title": "Titre court du signal US (max 12 mots)",
      "body": "Ce qui se passe aux US sur ce sujet, avec des chiffres et entreprises specifiques. Max 2 phrases.",
      "implication": "Ce que ca signifie pour cette reunion precise. Max 2 phrases.",
      "source": "Bloomberg · Juillet 2026"
    },
    {
      "title": "L objection principale que ce profil va sortir en reunion",
      "body": "Pourquoi les decideurs americains equivalents sortent cette objection, sur quoi elle est basee.",
      "implication": "Comment repondre avec des donnees US concretes. Max 2 phrases.",
      "source": "HBR · Juin 2026"
    },
    {
      "title": "Le benchmark US que ce profil va utiliser pour comparer",
      "body": "Les chiffres et standards du marche americain que ce type de prospect connait deja.",
      "implication": "Comment se positionner par rapport a ce benchmark. Max 2 phrases.",
      "source": "WSJ · Juillet 2026"
    }
  ],
  "retenir": "Une phrase de conclusion percutante sur l enjeu principal de cette reunion."
}`;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
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
      return new Response(JSON.stringify({ error: 'anthropic_error', detail: errText }), { status: 500 });
    }

    const anthropicData = await anthropicRes.json();
    const text = anthropicData.content[0].text.trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch(e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        return new Response(JSON.stringify({ error: 'parse_error', raw: text }), { status: 500 });
      }
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch(e) {
    return new Response(JSON.stringify({ error: 'server_error', message: e.message }), { status: 500 });
  }
}
