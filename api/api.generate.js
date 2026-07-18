export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const { prospect, subject } = await req.json();

  if (!prospect || !subject) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
  }

  const ip = req.headers.get('x-forwarded-for') || 'unknown';

  // Rate limiting via Supabase
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    const checkRes = await fetch(`${supabaseUrl}/rest/v1/rate_limits?ip=eq.${encodeURIComponent(ip)}&select=count,last_reset`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      }
    });

    const checkData = await checkRes.json();

    if (checkData && checkData.length > 0) {
      const record = checkData[0];
      const lastReset = new Date(record.last_reset);
      const now = new Date();
      const hoursDiff = (now - lastReset) / (1000 * 60 * 60);

      if (hoursDiff < 24 && record.count >= 1) {
        return new Response(JSON.stringify({ error: 'rate_limit', message: 'Tu as deja genere un brief aujourd\'hui. Reviens demain ou entre ton email pour en generer plus.' }), { status: 429 });
      }
    }

    // Upsert rate limit
    await fetch(`${supabaseUrl}/rest/v1/rate_limits`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ ip, count: 1, last_reset: new Date().toISOString() })
    });

  } catch (e) {
    // Continue even if rate limiting fails
  }

  const prompt = `Tu es un expert en veille commerciale B2B, specialise dans les tendances US qui arrivent en France avec 12 a 18 mois de decalage.

Un commercial francais prepare une reunion avec ce profil :
- Prospect : ${prospect}
- Sujet de la reunion : ${subject}

Genere un brief de veille commerciale en JSON avec exactement ce format :
{
  "signals": [
    {
      "title": "Titre court et percutant du signal US (max 15 mots)",
      "body": "Description du signal US : ce qui se passe aux Etats-Unis, avec des chiffres precis et des entreprises nommees. Max 3 phrases.",
      "implication": "Ce que ca signifie concretement pour cette reunion. Max 2 phrases.",
      "source": "Bloomberg · [mois] 2026"
    },
    {
      "title": "Deuxieme signal, une objection classique que ce profil va sortir en reunion",
      "body": "Contexte de cette objection : pourquoi les decideurs americains equivalents la sortent, sur quoi elle est basee.",
      "implication": "Comment repondre a cette objection avec des donnees US. Max 2 phrases.",
      "source": "HBR · [mois] 2026"
    },
    {
      "title": "Troisieme signal, un benchmark US que ce profil va utiliser pour comparer",
      "body": "Le benchmark precis que ce type de prospect connait : chiffres, entreprises, standards du marche americain.",
      "implication": "Comment se positionner par rapport a ce benchmark. Max 2 phrases.",
      "source": "WSJ · [mois] 2026"
    }
  ],
  "retenir": "Une phrase de conclusion percutante sur l'enjeu principal de cette reunion. Commence par un fait choc."
}

Reponds UNIQUEMENT avec le JSON, sans texte avant ou apres, sans backticks.`;

  try {
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

    const anthropicData = await anthropicRes.json();
    const text = anthropicData.content[0].text;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch(e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('Invalid JSON');
    }

    // Save search to Supabase
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_ANON_KEY;
      await fetch(`${supabaseUrl}/rest/v1/searches`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ip, prospect, subject, created_at: new Date().toISOString() })
      });
    } catch(e) {}

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch(e) {
    return new Response(JSON.stringify({ error: 'generation_failed' }), { status: 500 });
  }
}
