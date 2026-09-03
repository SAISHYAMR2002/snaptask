import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import AppLayout from './components/AppLayout'
import { Spinner } from './components/ui'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import Board from './pages/Board'
import Chat from './pages/Chat'
import Members from './pages/Members'
import Analytics from './pages/Analytics'
import Assistant from './pages/Assistant'
import Inbox from './pages/Inbox'
import Settings from './pages/Settings'
import VerifyEmail from './pages/VerifyEmail'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'

function ProtectedRoute() {
  const { user, loading } = useAuth()
  if (loading)
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    )
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/inbox" element={<Inbox />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/workspace/:id" element={<Board />} />
              <Route path="/workspace/:id/chat/:channelId" element={<Chat />} />
              <Route path="/workspace/:id/members" element={<Members />} />
              <Route path="/workspace/:id/analytics" element={<Analytics />} />
              <Route path="/workspace/:id/assistant" element={<Assistant />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
