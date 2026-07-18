export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, brief, prospect, subject, credits_remaining } = req.body;
  if (!email || !brief) return res.status(400).json({ error: 'Missing fields' });

  const signals = brief.signals || [];
  const score = brief.score || 72;
  const retenir = brief.retenir || '';

  const scoreColor = score >= 75 ? '#059669' : score >= 55 ? '#D97706' : '#EF4444';

  const signalsHtml = signals.map((s, i) => `
    <tr>
      <td style="padding:0 0 20px 0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:16px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:10px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
                <tr>
                  <td>
                    <span style="font-family:monospace;font-size:10px;font-weight:600;color:#C96A2E;background:#FEF3EC;padding:2px 8px;border-radius:3px;letter-spacing:0.04em;">
                      Signal 0${i+1}
                    </span>
                  </td>
                  <td align="right">
                    <span style="font-family:monospace;font-size:10px;color:#9CA3AF;">${s.source || ''}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-family:Inter,Arial,sans-serif;font-size:14px;font-weight:600;color:#111827;line-height:1.35;">${s.title || ''}</p>
              <p style="margin:0 0 12px 0;font-family:Inter,Arial,sans-serif;font-size:13px;color:#6B7280;line-height:1.55;">${s.body || ''}</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:8px 10px;background:#FFFBEB;border-left:3px solid #FCD34D;border-radius:0 5px 5px 0;">
                    <span style="font-size:10px;font-weight:700;color:#D97706;">→ </span>
                    <span style="font-family:Inter,Arial,sans-serif;font-size:12px;color:#92400E;">${s.implication || ''}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Ton brief Faro</title></head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:Inter,Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- HEADER -->
  <tr>
    <td style="background:#FFFFFF;border-radius:12px 12px 0 0;border:1px solid #E5E7EB;border-bottom:none;padding:24px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <span style="font-family:Inter,Arial,sans-serif;font-size:22px;font-weight:700;color:#C96A2E;letter-spacing:-0.03em;">faro</span>
          </td>
          <td align="right">
            <span style="font-family:monospace;font-size:10px;color:#9CA3AF;letter-spacing:0.1em;">BRIEF · ${new Date().toLocaleDateString('fr-FR', {day:'numeric',month:'long',year:'numeric'})}</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- CONTEXT -->
  <tr>
    <td style="background:#FEF3EC;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;padding:16px 32px;">
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-right:8px;">
            <span style="font-size:11px;font-weight:600;color:#C96A2E;background:#FEF3EC;border:1px solid #FDE8D5;padding:3px 10px;border-radius:4px;">${prospect || ''}</span>
          </td>
          <td>
            <span style="font-size:11px;font-weight:500;color:#6B7280;background:#F3F4F6;border:1px solid #E5E7EB;padding:3px 10px;border-radius:4px;">${subject || ''}</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- SCORE -->
  <tr>
    <td style="background:#FFFFFF;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;padding:20px 32px;border-bottom:1px solid #F3F4F6;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-right:20px;" width="80">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:64px;height:64px;border-radius:50%;border:4px solid ${scoreColor};text-align:center;vertical-align:middle;background:#FFFFFF;">
                  <span style="font-size:20px;font-weight:700;color:#111827;">${score}</span><br>
                  <span style="font-size:9px;color:#9CA3AF;">/100</span>
                </td>
              </tr>
            </table>
          </td>
          <td>
            <p style="margin:0 0 4px 0;font-size:14px;font-weight:600;color:#111827;">Score de préparation</p>
            <p style="margin:0;font-size:12px;color:#6B7280;line-height:1.5;">${retenir}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- SIGNALS TITLE -->
  <tr>
    <td style="background:#FFFFFF;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;padding:20px 32px 0;">
      <p style="margin:0 0 16px 0;font-family:monospace;font-size:10px;font-weight:600;color:#6B7280;letter-spacing:0.08em;text-transform:uppercase;">★ Signaux US identifiés</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${signalsHtml}
      </table>
    </td>
  </tr>

  <!-- CTA -->
  <tr>
    <td style="background:#FFFFFF;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;padding:24px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:18px 20px;">
            <p style="margin:0 0 4px 0;font-size:13px;font-weight:600;color:#111827;">Il te reste <span style="color:#C96A2E;">${credits_remaining || 4} briefs</span> disponibles cette semaine.</p>
            <p style="margin:0 0 14px 0;font-size:12px;color:#6B7280;">Prépare ta prochaine réunion avant tes concurrents.</p>
            <a href="https://latent-radar.vercel.app" style="display:inline-block;background:#C96A2E;color:#FFFFFF;text-decoration:none;padding:10px 20px;border-radius:7px;font-size:13px;font-weight:600;">Générer un nouveau brief →</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 12px 12px;padding:18px 32px;" align="center">
      <p style="margin:0;font-size:11px;color:#9CA3AF;">
        Faro · Copilote du premier rendez-vous commercial<br>
        <a href="#" style="color:#9CA3AF;">Se désabonner</a>
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>

</body>
</html>`;

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Faro <onboarding@resend.dev>',
        to: [email],
        subject: `Ton brief Faro · ${prospect} · ${subject}`,
        html
      })
    });

    if (!resendRes.ok) {
      const err = await resendRes.text();
      return res.status(500).json({ error: 'resend_error', detail: err });
    }

    const resendData = await resendRes.json();
    return res.status(200).json({ success: true, id: resendData.id });

  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
}
