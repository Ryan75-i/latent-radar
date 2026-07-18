export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const { email, prospect, subject } = await req.json();

  if (!email) {
    return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400 });
  }

  // Save to Supabase
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    await fetch(`${supabaseUrl}/rest/v1/subscribers`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        email,
        prospect,
        subject,
        source: 'latent-radar',
        created_at: new Date().toISOString()
      })
    });
  } catch(e) {}

  // Update rate limit - allow more generations after email
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const ip = req.headers.get('x-forwarded-for') || 'unknown';

    await fetch(`${supabaseUrl}/rest/v1/rate_limits?ip=eq.${encodeURIComponent(ip)}`, {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ count: 0 })
    });
  } catch(e) {}

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
