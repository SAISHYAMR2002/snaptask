import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { verifyEmail } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { AuthShell, Button, IconAlert, IconCheck, Spinner } from '../components/ui'

export default function VerifyEmail() {
  const [params] = useSearchParams()
  const { refreshUser } = useAuth()
  const token = params.get('token')
  const [state, setState] = useState('working') // working | done | error
  const [error, setError] = useState('')
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return // React 18 StrictMode mounts twice; the token is single-use
    ran.current = true

    if (!token) {
      setState('error')
      setError('That link is missing its token.')
      return
    }
    verifyEmail(token)
      .then(() => {
        setState('done')
        refreshUser()
      })
      .catch((e) => {
        setState('error')
        setError(e.response?.data?.error || 'Could not verify that link')
      })
  }, [token, refreshUser])

  return (
    <AuthShell>
      {state === 'working' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <Spinner />
          <p className="text-sm text-muted">Confirming your email…</p>
        </div>
      )}

      {state === 'done' && (
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-green-100 text-green-600">
            <IconCheck size={24} />
          </span>
          <h1 className="font-display text-xl font-extrabold">Email confirmed</h1>
          <p className="text-sm text-muted">Your account is fully set up.</p>
          <Link to="/" className="mt-2 w-full">
            <Button className="h-11 w-full">Go to SnapTask</Button>
          </Link>
        </div>
      )}

      {state === 'error' && (
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-red-100 text-red-600">
            <IconAlert size={24} />
          </span>
          <h1 className="font-display text-xl font-extrabold">Link didn't work</h1>
          <p className="text-sm text-muted">{error}</p>
          <p className="text-xs text-faint">
            You can send yourself a fresh link from Settings once you're logged in.
          </p>
          <Link to="/" className="mt-2 w-full">
            <Button variant="ghost" className="h-11 w-full">Back to SnapTask</Button>
          </Link>
        </div>
      )}
    </AuthShell>
  )
}
