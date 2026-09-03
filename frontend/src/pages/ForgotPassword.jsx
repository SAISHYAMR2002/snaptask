import { useState } from 'react'
import { Link } from 'react-router-dom'
import { forgotPassword } from '../lib/api'
import { AuthShell, Button, IconMail, TextField } from '../components/ui'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const res = await forgotPassword(email.trim())
      setSent(res)
    } catch (e) {
      setErr(e.response?.data?.error || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-brand-100 text-brand-600">
            <IconMail size={22} />
          </span>
          <h1 className="font-display text-xl font-extrabold">Check your email</h1>
          <p className="text-sm leading-relaxed text-muted">{sent.message}</p>

          {/* only present in dev, when no mail provider is configured */}
          {sent.resetUrl && (
            <div className="mt-2 w-full rounded-xl border border-amber-200 bg-amber-50 p-3 text-left">
              <p className="mb-1.5 text-[11px] font-extrabold tracking-wide text-amber-700">
                DEV MODE — NO MAIL PROVIDER CONFIGURED
              </p>
              <a href={sent.resetUrl} className="text-[12px] font-bold break-all text-brand-700 underline">
                {sent.resetUrl}
              </a>
            </div>
          )}

          <Link to="/login" className="mt-2 w-full">
            <Button variant="ghost" className="h-11 w-full">Back to log in</Button>
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-extrabold tracking-tight">Forgot your password?</h1>
      <p className="mt-1.5 mb-6 text-sm text-muted">
        Enter your email and we'll send you a link to choose a new one.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Email"
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        {err && <p className="text-xs font-semibold text-red-600">{err}</p>}
        <Button type="submit" className="h-11 w-full" disabled={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-muted">
        Remembered it?{' '}
        <Link to="/login" className="font-bold text-brand-600 hover:text-brand-700">Log in</Link>
      </p>
    </AuthShell>
  )
}
