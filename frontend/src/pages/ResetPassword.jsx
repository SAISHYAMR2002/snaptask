import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { resetPassword } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { AuthShell, Button, TextField } from '../components/ui'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { adoptSession } = useAuth()
  const token = params.get('token')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (password !== confirm) {
      setErr('The two passwords do not match')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const res = await resetPassword(token, password)
      // the API hands back a fresh session, so land them straight in the app
      adoptSession(res.user, res.token)
      navigate('/')
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not reset your password')
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <AuthShell>
        <h1 className="font-display text-xl font-extrabold">Link is missing its token</h1>
        <p className="mt-2 mb-5 text-sm text-muted">Request a new reset link and try again.</p>
        <Link to="/forgot-password">
          <Button className="h-11 w-full">Request a new link</Button>
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-extrabold tracking-tight">Choose a new password</h1>
      <p className="mt-1.5 mb-6 text-sm text-muted">
        At least 8 characters, with a letter and a number.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="New password"
          type="password"
          required
          placeholder="••••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        <TextField
          label="Confirm new password"
          type="password"
          required
          placeholder="••••••••••"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {err && <p className="text-xs font-semibold text-danger">{err}</p>}
        <Button type="submit" className="h-11 w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Set new password'}
        </Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-muted">
        <Link to="/login" className="font-bold text-brand-700 hover:text-brand-700">Back to log in</Link>
      </p>
    </AuthShell>
  )
}
