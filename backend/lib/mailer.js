/**
 * Email adapter.
 *
 * With RESEND_API_KEY set in .env, mail is actually sent through Resend
 * (https://resend.com — free tier, no SMTP setup). Without a key it falls back
 * to logging the message, so every email path still runs end-to-end in dev
 * and nothing crashes. Sent mail is also recorded in the server log either way.
 */
const FROM = process.env.MAIL_FROM || 'SnapTask <onboarding@resend.dev>'
const KEY = process.env.RESEND_API_KEY

async function sendEmail({ to, subject, html, text }) {
  if (!KEY) {
    console.log(`[email:dev] -> ${to} | ${subject}`)
    return { delivered: false, reason: 'no RESEND_API_KEY set (logged instead)' }
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html: html || text, text }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`[email:fail] ${res.status} ${body}`)
      return { delivered: false, reason: `resend ${res.status}` }
    }
    console.log(`[email:sent] -> ${to} | ${subject}`)
    return { delivered: true }
  } catch (err) {
    console.error('[email:error]', err.message)
    return { delivered: false, reason: err.message }
  }
}

const wrap = (title, body, cta) => `
  <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
    <div style="font-weight:800;font-size:18px;color:#7c3aed;margin-bottom:16px">SnapTask</div>
    <h1 style="font-size:18px;margin:0 0 8px;color:#1e1b2e">${title}</h1>
    <div style="font-size:14px;line-height:1.6;color:#4a4760">${body}</div>
    ${cta ? `<p style="margin-top:20px"><a href="${cta}" style="background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open SnapTask</a></p>` : ''}
  </div>`

module.exports = { sendEmail, wrap }
