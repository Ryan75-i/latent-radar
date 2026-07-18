export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, prospect, subject, brief, credits_remaining } = req.body;
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

    let token, cr, reset_at;

    if (existing && existing.length > 0) {
      token = existing[0].token;
      cr = existing[0].credits_remaining;
      reset_at = existing[0].reset_at;

      if (now > new Date(reset_at)) {
        reset_at = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        cr = 5;
        await fetch(`${supabaseUrl}/rest/v1/tokens?token=eq.${token}`, {
          method: 'PATCH',
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ credits_remaining: 5, credits_used: 0, reset_at })
        });
      }
    } else {
      reset_at = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      cr = 4;

      const tokenRes = await fetch(`${supabaseUrl}/rest/v1/tokens`, {
        method: 'POST',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ email, credits_remaining: cr, credits_used: 1, reset_at })
      });
      const tokenData = await tokenRes.json();
      token = tokenData[0]?.token;

      // Enregistrer subscriber
      await fetch(`${supabaseUrl}/rest/v1/subscribers`, {
        method: 'POST',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ email, prospect: prospect || null, subject: subject || null, source: 'faro-tool', ip, created_at: now.toISOString() })
      });

      // Reset rate limit
      await fetch(`${supabaseUrl}/rest/v1/rate_limits?ip=eq.${encodeURIComponent(ip)}`, {
        method: 'PATCH',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 0 })
      });
    }

    // 2. Envoyer email avec le brief — HORS du if/else, s'exécute pour tout le monde
    let emailDebug = null;
    if (brief && process.env.RESEND_API_KEY) {
      const signals = brief.signals || [];
      const score = brief.score || 72;
      const retenir = brief.retenir || '';
      const scoreColor = score >= 75 ? '#059669' : score >= 55 ? '#D97706' : '#EF4444';

      const signalsHtml = signals.map((s, i) => `
        <div style="margin-bottom:16px;padding:16px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:8px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:10px;font-weight:600;color:#C96A2E;background:#FEF3EC;padding:2px 8px;border-radius:3px;">Signal 0${i+1}</span>
            <span style="font-size:10px;color:#9CA3AF;font-family:monospace;">${s.source || ''}</span>
          </div>
          <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#111827;">${s.title || ''}</p>
          <p style="margin:0 0 10px;font-size:12px;color:#6B7280;line-height:1.5;">${s.body || ''}</p>
          <div style="padding:8px 10px;background:#FFFBEB;border-left:3px solid #FCD34D;border-radius:0 4px 4px 0;">
            <span style="font-size:12px;color:#92400E;">→ ${s.implication || ''}</span>
          </div>
        </div>
      `).join('');

      const emailHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
  <tr><td style="background:#FFFFFF;border-radius:12px 12px 0 0;border:1px solid #E5E7EB;border-bottom:none;padding:24px 32px;">
    <table width="100%"><tr>
      <td><span style="font-size:22px;font-weight:700;color:#C96A2E;">faro</span></td>
      <td align="right"><span style="font-size:10px;color:#9CA3AF;font-family:monospace;">${new Date().toLocaleDateString('fr-FR', {day:'numeric',month:'long',year:'numeric'})}</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#FEF3EC;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;padding:12px 32px;">
    <span style="font-size:11px;font-weight:600;color:#C96A2E;background:#FEF3EC;border:1px solid #FDE8D5;padding:3px 10px;border-radius:4px;">${prospect || ''}</span>
    &nbsp;
    <span style="font-size:11px;font-weight:500;color:#6B7280;background:#F3F4F6;border:1px solid #E5E7EB;padding:3px 10px;border-radius:4px;">${subject || ''}</span>
  </td></tr>
  <tr><td style="background:#FFFFFF;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;padding:20px 32px;border-bottom:1px solid #F3F4F6;">
    <table><tr>
      <td style="padding-right:16px;">
        <div style="width:60px;height:60px;border-radius:50%;border:4px solid ${scoreColor};display:flex;align-items:center;justify-content:center;text-align:center;background:#FFFFFF;">
          <div><span style="font-size:18px;font-weight:700;color:#111827;">${score}</span><br><span style="font-size:9px;color:#9CA3AF;">/100</span></div>
        </div>
      </td>
      <td>
        <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#111827;">Score de préparation</p>
        <p style="margin:0;font-size:12px;color:#6B7280;line-height:1.5;">${retenir}</p>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#F9FAFB;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;padding:20px 32px;">
    <p style="margin:0 0 14px;font-size:10px;font-weight:600;color:#6B7280;letter-spacing:0.08em;text-transform:uppercase;">★ Signaux US identifiés</p>
    ${signalsHtml}
  </td></tr>
  <tr><td style="background:#FFFFFF;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;padding:20px 32px;">
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:16px;">
      <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#111827;">Il te reste <span style="color:#C96A2E;">${cr} briefs</span> cette semaine.</p>
      <p style="margin:0 0 12px;font-size:12px;color:#6B7280;">Prépare ta prochaine réunion avant tes concurrents.</p>
      <a href="https://latent-radar.vercel.app" style="display:inline-block;background:#C96A2E;color:#FFFFFF;text-decoration:none;padding:10px 20px;border-radius:7px;font-size:13px;font-weight:600;">Générer un nouveau brief →</a>
    </div>
  </td></tr>
  <tr><td style="background:#F9FAFB;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 12px 12px;padding:16px 32px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#9CA3AF;">Faro · Copilote du premier rendez-vous commercial</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: 'Faro <hello@farobrief.com>',
          to: [email],
          subject: `Ton brief Faro · ${prospect} · ${subject}`,
          html: emailHtml
        })
      });
      emailDebug = await resendRes.json();
      console.log('[RESEND] status:', resendRes.status, 'body:', JSON.stringify(emailDebug));
    } else {
      console.log('[RESEND] envoi sauté — brief présent ?', !!brief, '| clé présente ?', !!process.env.RESEND_API_KEY);
    }

    return res.status(200).json({ success: true, token, credits_remaining: cr, reset_at, email_debug: emailDebug });

  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
}
