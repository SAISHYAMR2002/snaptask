// Small shared helpers + the colour maps that keep the UI consistent.

export const STATUSES = [
  { key: 'todo', label: 'To Do', dot: '#7c3aed', chip: 'bg-brand-100 text-brand-700' },
  { key: 'in-progress', label: 'In Progress', dot: '#f59e0b', chip: 'bg-warn-soft text-warn-ink' },
  { key: 'done', label: 'Done', dot: '#22c55e', chip: 'bg-success-soft text-success-ink' },
]

export const statusMeta = (key) => STATUSES.find((s) => s.key === key) || STATUSES[0]

export const PRIORITIES = [
  { key: 'low', label: 'Low', dot: '#22c55e' },
  { key: 'medium', label: 'Medium', dot: '#f59e0b' },
  { key: 'high', label: 'High', dot: '#ef4444' },
]

export const priorityMeta = (key) => PRIORITIES.find((p) => p.key === key) || PRIORITIES[1]

// Labels store a colour NAME, not a hex value, so the same label reads
// correctly in both themes — each name maps to a light and a dark treatment.
export const LABEL_COLORS = [
  { key: 'violet', swatch: '#7c3aed', chip: 'bg-brand-100 text-brand-700' },
  { key: 'blue', swatch: '#2563eb', chip: 'bg-info-soft text-info-ink' },
  { key: 'green', swatch: '#16a34a', chip: 'bg-success-soft text-success-ink' },
  { key: 'amber', swatch: '#d97706', chip: 'bg-warn-soft text-warn-ink' },
  { key: 'red', swatch: '#dc2626', chip: 'bg-danger-soft text-danger-ink' },
  { key: 'gray', swatch: '#64748b', chip: 'bg-surface-3 text-muted' },
]
export const labelMeta = (key) => LABEL_COLORS.find((c) => c.key === key) || LABEL_COLORS[0]

/** "3h" / "1.5h" / "2d 4h" — estimates and cycle times read better than raw floats. */
export function formatHours(h) {
  if (h == null || !Number.isFinite(Number(h))) return null
  const n = Number(h)
  if (n < 1) return `${Math.round(n * 60)}m`
  if (n < 24) return `${Math.round(n * 10) / 10}h`
  const days = Math.floor(n / 24)
  const rest = Math.round(n % 24)
  return rest ? `${days}d ${rest}h` : `${days}d`
}

// A stable-ish gradient for an avatar, picked from the person's id/name.
const AVATAR_GRADIENTS = [
  'linear-gradient(160deg,#f0abfc,#c026d3)',
  'linear-gradient(160deg,#fda4af,#e11d48)',
  'linear-gradient(160deg,#6ee7b7,#059669)',
  'linear-gradient(160deg,#93c5fd,#2563eb)',
  'linear-gradient(160deg,#c4b5fd,#7c3aed)',
  'linear-gradient(160deg,#fcd34d,#d97706)',
]
export function avatarGradient(seed = '') {
  let n = 0
  for (const ch of seed) n = (n + ch.charCodeAt(0)) % AVATAR_GRADIENTS.length
  return AVATAR_GRADIENTS[n]
}

export function initials(name = '') {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('')
}

const WS_DOTS = ['#7c3aed', '#3b82f6', '#f59e0b', '#14b8a6', '#ec4899', '#8b5cf6']
export const workspaceDot = (seed = '') => {
  let n = 0
  for (const ch of seed) n = (n + ch.charCodeAt(0)) % WS_DOTS.length
  return WS_DOTS[n]
}

// "Today" / "Tomorrow" / "Sep 5" / "Sep 5, 2027", plus an overdue flag.
export function formatDue(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const now = new Date()
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate())
  const days = Math.round((startOf(d) - startOf(now)) / 86400000)
  let label
  if (days === 0) label = 'Today'
  else if (days === 1) label = 'Tomorrow'
  else if (days === -1) label = 'Yesterday'
  else {
    const opts = { month: 'short', day: 'numeric' }
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
    label = d.toLocaleDateString(undefined, opts)
  }
  return { label, overdue: days < 0, soon: days >= 0 && days <= 2 }
}

export function isSameWeek(iso) {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  const diff = (d - now) / 86400000
  return diff >= -0.5 && diff <= 7
}
