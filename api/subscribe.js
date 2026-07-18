export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, prospect, subject } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = new Date();

  try {
    // 1. Vérifier si token existe déjà pour cet email
    const existingRes = await fetch(
      `${supabaseUrl}/rest/v1/tokens?email=eq.${encodeURIComponent(email)}&select=token,credits_remaining,reset_at&order=created_at.desc&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    const existing = await existingRes.json();

    let token, credits_remaining, reset_at;

    if (existing && existing.length > 0) {
      // Email connu : retourner token existant
      token = existing[0].token;
      credits_remaining = existing[0].credits_remaining;
      reset_at = existing[0].reset_at;

      // Reset si semaine expirée
      if (now > new Date(reset_at)) {
        reset_at = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        credits_remaining = 5;
        await fetch(`${supabaseUrl}/rest/v1/tokens?token=eq.${token}`, {
          method: 'PATCH',
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ credits_remaining: 5, credits_used: 0, reset_at })
        });
      }

    } else {
      // Nouvel email : créer token
      reset_at = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      credits_remaining = 4;

      const tokenRes = await fetch(`${supabaseUrl}/rest/v1/tokens`, {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify({ email, credits_remaining, credits_used: 1, reset_at })
      });
      const tokenData = await tokenRes.json();
      token = tokenData[0]?.token;

      // Enregistrer dans subscribers (insert simple)
      const subRes = await fetch(`${supabaseUrl}/rest/v1/subscribers`, {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          email,
          prospect: prospect || null,
          subject: subject || null,
          source: 'faro-tool',
          ip,
          created_at: now.toISOString()
        })
      });

      if (!subRes.ok) {
        const subErr = await subRes.text();
        console.error('subscribers insert error:', subErr);
      }

      // Reset rate limit IP
      await fetch(`${supabaseUrl}/rest/v1/rate_limits?ip=eq.${encodeURIComponent(ip)}`, {
        method: 'PATCH',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 0 })
      });
    }

    return res.status(200).json({ success: true, token, credits_remaining, reset_at });

  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
}
