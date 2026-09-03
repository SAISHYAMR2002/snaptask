import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { authLogin, authSignup, authMe } from '../lib/api'

const AuthContext = createContext(null)

const TOKEN_KEY = 'snaptask_token'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true) // true while we check an existing token on load

  // On first load: if there's a saved token, ask the backend who we are.
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) {
      setLoading(false)
      return
    }
    authMe()
      .then(setUser)
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email, password) => {
    const { user, token } = await authLogin(email, password)
    localStorage.setItem(TOKEN_KEY, token)
    setUser(user)
  }, [])

  const signup = useCallback(async (name, email, password) => {
    const { user, token } = await authSignup(name, email, password)
    localStorage.setItem(TOKEN_KEY, token)
    setUser(user)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
  }, [])

  // re-read the user from the API (after verifying an email, renaming, ...)
  const refreshUser = useCallback(() => authMe().then(setUser).catch(() => {}), [])

  // used by the reset-password flow, which hands back a fresh session
  const adoptSession = useCallback((nextUser, token) => {
    localStorage.setItem(TOKEN_KEY, token)
    setUser(nextUser)
  }, [])

  return (
    <AuthContext.Provider
      value={{ user, loading, login, signup, logout, refreshUser, adoptSession, setUser }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
