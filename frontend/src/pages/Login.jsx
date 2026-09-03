import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { AuthShell, Button, TextField } from '../components/ui'

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await login(form.email.trim(), form.password)
      navigate('/')
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not log in')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-extrabold tracking-tight">Welcome back</h1>
      <p className="mt-1.5 mb-6 text-sm text-muted">Log in to jump back into your team's work.</p>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Email"
          type="email"
          required
          placeholder="you@example.com"
          value={form.email}
          onChange={set('email')}
        />
        <div>
          <TextField
            label="Password"
            type="password"
            required
            placeholder="••••••••••"
            value={form.password}
            onChange={set('password')}
          />
          <Link
            to="/forgot-password"
            className="mt-1.5 block text-right text-xs font-bold text-brand-700 hover:text-brand-700"
          >
            Forgot password?
          </Link>
        </div>
        {err && <p className="text-xs font-semibold text-danger">{err}</p>}
        <Button type="submit" className="h-11 w-full" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-muted">
        New here?{' '}
        <Link to="/signup" className="font-bold text-brand-700 hover:text-brand-700">
          Create an account
        </Link>
      </p>
    </AuthShell>
  )
}
