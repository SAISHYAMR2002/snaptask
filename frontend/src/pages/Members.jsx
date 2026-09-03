import { useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { addMember, removeMember, setMemberRole } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { PageHeader } from '../components/AppLayout'
import { Avatar, Button, IconPlus, IconTrash, Pill, Spinner, TextField } from '../components/ui'

const ROLE_TONE = { owner: 'brand', admin: 'amber', member: 'gray' }

export default function Members() {
  const { id } = useParams()
  const { user } = useAuth()
  const { workspace, myRole, reloadWorkspace } = useOutletContext()
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!workspace) {
    return (
      <>
        <PageHeader title="Members" />
        <div className="grid flex-1 place-items-center"><Spinner /></div>
      </>
    )
  }

  const isOwner = myRole === 'owner'
  const isAdmin = myRole === 'owner' || myRole === 'admin'

  const invite = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true); setMsg(null)
    try {
      await addMember(id, email.trim())
      setEmail('')
      setMsg({ ok: true, text: 'Added. They can see this workspace now.' })
      reloadWorkspace()
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.error || 'Could not add them' })
    } finally { setBusy(false) }
  }

  const changeRole = async (userId, role) => {
    setMsg(null)
    try {
      await setMemberRole(id, userId, role)
      reloadWorkspace()
      setMsg({ ok: true, text: role === 'admin' ? 'Promoted to admin.' : 'Changed to member.' })
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.error || 'Could not change the role' })
    }
  }

  const kick = async (userId, name) => {
    if (!confirm(`Remove ${name} from ${workspace.name}?`)) return
    setMsg(null)
    try {
      await removeMember(id, userId)
      reloadWorkspace()
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.error || 'Could not remove them' })
    }
  }

  return (
    <>
      <PageHeader title="Members" subtitle={workspace.name} />

      <div className="flex flex-col gap-6 overflow-y-auto p-7">
        {/* who can do what */}
        <div className="rounded-2xl border border-line bg-[#faf8ff] p-4">
          <h2 className="mb-2 font-display text-sm font-extrabold">How access works</h2>
          <ul className="flex flex-col gap-1.5 text-[13px] text-ink-soft">
            <li className="flex gap-2"><Pill tone="brand">owner</Pill> created the workspace. Can promote/demote admins and delete the workspace.</li>
            <li className="flex gap-2"><Pill tone="amber">admin</Pill> can see <b>Team Analytics</b>, invite people and remove members.</li>
            <li className="flex gap-2"><Pill tone="gray">member</Pill> can use the board and chat.</li>
          </ul>
          {!isOwner && (
            <p className="mt-3 text-xs text-muted">
              You are {myRole === 'admin' ? 'an admin' : 'a member'} here — only the owner can change roles.
            </p>
          )}
        </div>

        {/* invite */}
        {isAdmin && (
          <form onSubmit={invite} className="flex items-end gap-3">
            <div className="w-80">
              <TextField
                label="Invite by email"
                type="email"
                placeholder="teammate@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" className="h-11" disabled={busy}>
              <IconPlus size={14} /> {busy ? 'Adding…' : 'Add member'}
            </Button>
          </form>
        )}

        {msg && (
          <p className={`text-[13px] font-semibold ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>
        )}

        {/* list */}
        <div className="overflow-hidden rounded-2xl border border-line">
          <div className="grid grid-cols-[2fr_1fr_auto] gap-4 bg-[#faf8ff] px-5 py-2.5 text-[10px] font-extrabold tracking-wider text-faint">
            <span>PERSON</span><span>ROLE</span><span />
          </div>
          {workspace.members.map((m) => (
            <div key={m.id} className="grid grid-cols-[2fr_1fr_auto] items-center gap-4 border-t border-[#f4f1fc] px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={m.name} size={32} />
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-bold">
                    {m.name} {m.id === user?.id && <span className="text-faint font-semibold">(you)</span>}
                  </div>
                  <div className="truncate text-xs text-faint">{m.email}</div>
                </div>
              </div>

              <div>
                {isOwner && m.role !== 'owner' ? (
                  <select
                    value={m.role}
                    onChange={(e) => changeRole(m.id, e.target.value)}
                    className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] font-bold text-ink-soft outline-none focus:border-brand-500"
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                ) : (
                  <Pill tone={ROLE_TONE[m.role]}>{m.role}</Pill>
                )}
              </div>

              <div>
                {isAdmin && m.role !== 'owner' && m.id !== user?.id && (
                  <button
                    onClick={() => kick(m.id, m.name)}
                    className="rounded-lg p-2 text-faint hover:bg-red-50 hover:text-red-600"
                    title="Remove from workspace"
                  >
                    <IconTrash size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
