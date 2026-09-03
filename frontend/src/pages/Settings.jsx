import { useEffect, useState } from 'react'
import {
  changePassword,
  getPrefs,
  resendVerification,
  sendTestEmail,
  updatePrefs,
  updateProfile,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { PageHeader } from '../components/AppLayout'
import { Avatar, Button, IconCheck, IconMail, Pill, Spinner, TextField } from '../components/ui'

/** Account: display name, email verification state, and password change. */
function AccountSection() {
  const { user, refreshUser } = useAuth()
  const [name, setName] = useState(user?.name || '')
  const [msg, setMsg] = useState(null)
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwMsg, setPwMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const saveName = async () => {
    if (!name.trim() || name.trim() === user?.name) return
    try {
      await updateProfile(name.trim())
      await refreshUser()
      setMsg({ ok: true, text: 'Name updated' })
    } catch (e) {
      setMsg({ ok: false, text: e.response?.data?.error || 'Could not update' })
    }
    setTimeout(() => setMsg(null), 2500)
  }

  const resend = async () => {
    try {
      const res = await resendVerification()
      setMsg({ ok: true, text: res.verifyUrl ? 'Sent — dev link in the banner above' : 'Verification email sent' })
    } catch (e) {
      setMsg({ ok: false, text: e.response?.data?.error || 'Could not send' })
    }
    setTimeout(() => setMsg(null), 4000)
  }

  const savePassword = async (e) => {
    e.preventDefault()
    if (pw.next !== pw.confirm) return setPwMsg({ ok: false, text: 'The two new passwords do not match' })
    setBusy(true)
    setPwMsg(null)
    try {
      await changePassword(pw.current, pw.next)
      setPw({ current: '', next: '', confirm: '' })
      setPwMsg({ ok: true, text: 'Password changed' })
    } catch (e) {
      setPwMsg({ ok: false, text: e.response?.data?.error || 'Could not change password' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2 className="font-display text-[17px] font-extrabold">Account</h2>

      <div className="mt-4 flex items-center gap-3.5 rounded-2xl border border-line p-4">
        <Avatar name={user?.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-extrabold">{user?.name}</div>
          <div className="truncate text-[12.5px] text-muted">{user?.email}</div>
        </div>
        {user?.emailVerified ? (
          <Pill tone="green"><IconCheck size={11} />Verified</Pill>
        ) : (
          <div className="flex items-center gap-2">
            <Pill tone="amber">Unverified</Pill>
            <Button variant="ghost" className="h-8 px-3 text-xs" onClick={resend}>Resend</Button>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-end gap-3">
        <div className="w-72">
          <TextField label="Display name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button variant="ghost" className="h-11" onClick={saveName} disabled={!name.trim() || name.trim() === user?.name}>
          Save name
        </Button>
        {msg && (
          <span className={`pb-3 text-xs font-bold ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>
        )}
      </div>

      <form onSubmit={savePassword} className="mt-6 rounded-2xl border border-line p-4">
        <h3 className="mb-3 text-[13px] font-extrabold">Change password</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Current" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <TextField label="New" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          <TextField label="Confirm new" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button type="submit" className="h-10" disabled={busy || !pw.current || !pw.next}>
            {busy ? 'Saving…' : 'Update password'}
          </Button>
          {pwMsg && (
            <span className={`text-xs font-bold ${pwMsg.ok ? 'text-green-600' : 'text-red-600'}`}>{pwMsg.text}</span>
          )}
        </div>
      </form>
    </>
  )
}

function Toggle({ on, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition ${on ? 'bg-brand-600' : 'bg-surface-3'}`}
      aria-pressed={on}
    >
      <span
        className={`absolute top-[3px] size-4 rounded-full bg-surface transition-all ${on ? 'left-[19px]' : 'left-[3px]'}`}
      />
    </button>
  )
}

function Row({ title, hint, badge, children, on, onChange }) {
  return (
    <div className="flex items-start gap-4 border-t border-line-soft py-3.5">
      <div className="flex-1">
        <div className="flex items-center gap-2 text-[13px] font-bold">
          {title} {badge}
        </div>
        {hint && <div className="mt-0.5 text-[11.5px] text-faint">{hint}</div>}
        {children && <div className="mt-2">{children}</div>}
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  )
}

const Label = ({ children }) => (
  <div className="mt-6 mb-0.5 text-[11px] font-extrabold tracking-wider text-faint">{children}</div>
)

export default function Settings() {
  const { user } = useAuth()
  const [prefs, setPrefs] = useState(null)
  const [emailConfigured, setEmailConfigured] = useState(false)
  const [saved, setSaved] = useState('')
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    getPrefs().then((d) => {
      setPrefs(d.prefs)
      setEmailConfigured(d.emailConfigured)
    })
  }, [])

  // optimistic save — flip locally, persist, show a confirmation
  const set = async (patch) => {
    setPrefs((p) => ({ ...p, ...patch }))
    try {
      const updated = await updatePrefs(patch)
      setPrefs(updated)
      setSaved('Saved')
      setTimeout(() => setSaved(''), 1500)
    } catch {
      setSaved('Could not save')
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const r = await sendTestEmail()
      setSaved(r.delivered ? `Sent to ${r.to}` : `Logged to the server console (${r.reason})`)
    } finally {
      setTesting(false)
      setTimeout(() => setSaved(''), 4000)
    }
  }

  if (!prefs) {
    return <><PageHeader title="Settings" /><div className="grid flex-1 place-items-center"><Spinner /></div></>
  }

  return (
    <>
      <PageHeader title="Settings">
        {saved && <span className="text-[12.5px] font-bold text-green-600">{saved}</span>}
      </PageHeader>

      <div className="overflow-y-auto p-7">
        <div className="max-w-2xl">
          <AccountSection />

          <h2 className="mt-8 font-display text-[17px] font-extrabold">Notifications &amp; email</h2>
          <p className="mt-1 text-[12.5px] text-muted">
            Choose what SnapTask emails you and when it reminds you.
          </p>

          <div
            className={`mt-4 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 ${
              emailConfigured ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'
            }`}
          >
            <IconMail size={16} className={emailConfigured ? 'text-green-600' : 'text-amber-600'} />
            <span className="flex-1 text-[12.5px] font-semibold text-ink-soft">
              {emailConfigured
                ? 'Email delivery is configured — real emails will be sent.'
                : 'No email provider key set — emails are written to the server console instead.'}
            </span>
            <Button variant="ghost" className="h-8 px-3 text-xs" onClick={test} disabled={testing}>
              {testing ? 'Sending…' : 'Send test'}
            </Button>
          </div>

          <Label>EMAIL ME WHEN…</Label>
          <Row title="I'm assigned a task" hint="Someone puts a task in my name"
            on={prefs.emailAssigned} onChange={(v) => set({ emailAssigned: v })} />
          <Row title="Someone @mentions me" hint="In a chat message"
            on={prefs.emailMention} onChange={(v) => set({ emailMention: v })} />
          <Row title="A comment is added to my task" hint="Replies on tasks I created or am assigned"
            on={prefs.emailComment} onChange={(v) => set({ emailComment: v })} />
          <Row title="A task changes status" hint="Moves between To Do / In Progress / Done"
            on={prefs.emailStatus} onChange={(v) => set({ emailStatus: v })} />

          <Label>DIGESTS &amp; REPORTS</Label>
          <Row
            title="Daily digest"
            badge={<Pill tone="brand">{String(prefs.digestHour).padStart(2, '0')}:00</Pill>}
            hint="A morning summary of what's due and assigned"
            on={prefs.dailyDigest}
            onChange={(v) => set({ dailyDigest: v })}
          >
            <select
              value={prefs.digestHour}
              onChange={(e) => set({ digestHour: Number(e.target.value) })}
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] font-bold text-ink-soft outline-none"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
          </Row>
          <Row title="Weekly team report" badge={<Pill tone="amber">ADMIN</Pill>}
            hint="Monday recap of throughput, at-risk members and overdue work"
            on={prefs.weeklyReport} onChange={(v) => set({ weeklyReport: v })} />

          <Label>REMINDERS</Label>
          <Row
            title="Remind me before a task is due"
            hint="Email + inbox nudge ahead of the deadline"
            on={prefs.remindBeforeDue}
            onChange={(v) => set({ remindBeforeDue: v })}
          >
            <div className="flex gap-1.5">
              {[1, 6, 24, 48].map((h) => (
                <button
                  key={h}
                  onClick={() => set({ remindHours: h })}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                    prefs.remindHours === h
                      ? 'border-brand-200 bg-brand-50 text-brand-700'
                      : 'border-line text-muted hover:bg-brand-50'
                  }`}
                >
                  {h}h before
                </button>
              ))}
            </div>
          </Row>
          <Row title="Nudge me about overdue tasks" hint="Until they're done or rescheduled"
            on={prefs.nudgeOverdue} onChange={(v) => set({ nudgeOverdue: v })} />

          <p className="mt-6 pb-4 text-xs text-faint">
            Changes save automatically. The reminder sweep runs every 30 minutes on the server.
          </p>
        </div>
      </div>
    </>
  )
}
