import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { AuthShell, Button, TextField } from '../components/ui'

export default function Signup() {
  const { user, signup } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    if (form.password.length < 8) {
      setErr('Password must be at least 8 characters')
      return
    }
    setBusy(true)
    setErr('')
    try {
      await signup(form.name.trim(), form.email.trim(), form.password)
      navigate('/')
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not create account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-extrabold tracking-tight">Create your account</h1>
      <p className="mt-1.5 mb-6 text-sm text-muted">Free to start. Bring your team in minutes.</p>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Name"
          required
          placeholder="Your name"
          value={form.name}
          onChange={set('name')}
        />
        <TextField
          label="Email"
          type="email"
          required
          placeholder="you@example.com"
          value={form.email}
          onChange={set('email')}
        />
        <TextField
          label="Password"
          type="password"
          required
          placeholder="At least 8 characters"
          value={form.password}
          onChange={set('password')}
        />
        {err && <p className="text-xs font-semibold text-danger">{err}</p>}
        <Button type="submit" className="h-11 w-full" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-bold text-brand-700 hover:text-brand-700">
          Log in
        </Link>
      </p>
    </AuthShell>
  )
}
