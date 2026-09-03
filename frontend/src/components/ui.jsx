import { useEffect } from 'react'
import { avatarGradient, initials, priorityMeta, statusMeta } from '../lib/helpers'

/* ---------- tiny inline icons (stroke, 24-grid) ---------- */
const mk =
  (path, opts = {}) =>
  ({ size = 16, className = '', stroke = 'currentColor', fill = 'none' }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={opts.w || 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {path}
    </svg>
  )

export const IconCheck = mk(<path d="M20 6 9 17l-5-5" />, { w: 3 })
export const IconPlus = mk(<path d="M12 5v14M5 12h14" />, { w: 2.5 })
export const IconX = mk(<path d="M18 6 6 18M6 6l12 12" />)
export const IconChevronDown = mk(<path d="m6 9 6 6 6-6" />, { w: 2.5 })
export const IconHome = mk(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>)
export const IconBoard = mk(<><rect x="3" y="3" width="18" height="18" rx="4" /><path d="m8 12 3 3 5-6" /></>)
export const IconLogout = mk(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>)
export const IconTrash = mk(<><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></>)
export const IconCalendar = mk(<><rect x="3" y="4.5" width="18" height="17" rx="3" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></>)

/* ---------- primitives ---------- */
export function Logo({ size = 28 }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className="grid place-items-center rounded-[9px] text-white shadow-[0_5px_14px_rgba(124,58,237,0.35)]"
        style={{
          width: size,
          height: size,
          background: 'linear-gradient(160deg,#a78bfa,#7c3aed)',
        }}
      >
        <IconCheck size={size * 0.55} stroke="#fff" />
      </span>
      <span className="font-display text-[17px] font-extrabold tracking-tight">SnapTask</span>
    </span>
  )
}

export function Avatar({ name = '', size = 28, className = '' }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-[30%] font-extrabold text-white ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.38, background: avatarGradient(name) }}
      title={name}
    >
      {initials(name) || '?'}
    </span>
  )
}

export function PriorityDot({ value }) {
  const p = priorityMeta(value)
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted">
      <span className="size-[7px] rounded-full" style={{ background: p.dot }} />
      {p.label}
    </span>
  )
}

export function StatusBadge({ value }) {
  const s = statusMeta(value)
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold ${s.chip}`}>
      {s.label}
    </span>
  )
}

export function Button({ variant = 'primary', className = '', ...props }) {
  const styles = {
    primary:
      'text-white bg-linear-to-b from-brand-500 to-brand-600 shadow-[0_6px_16px_rgba(124,58,237,0.3)] hover:from-brand-600 hover:to-brand-700',
    ghost: 'bg-white text-ink-soft border border-line hover:bg-brand-50',
    danger: 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100',
  }
  return (
    <button
      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-4 text-[13px] font-bold transition disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    />
  )
}

export function TextField({ label, className = '', ...props }) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-xs font-bold text-ink-soft">{label}</span>
      )}
      <input
        className={`h-11 w-full rounded-xl border-[1.5px] border-line bg-[#fdfcff] px-3.5 text-sm outline-none placeholder:text-faint focus:border-brand-500 ${className}`}
        {...props}
      />
    </label>
  )
}

export function Spinner({ className = '' }) {
  return (
    <span
      className={`inline-block size-5 animate-spin rounded-full border-2 border-line border-t-brand-600 ${className}`}
    />
  )
}

export function EmptyState({ title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-14 text-center">
      <p className="font-display text-[15px] font-extrabold">{title}</p>
      {hint && <p className="max-w-xs text-[13px] text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function AuthShell({ children }) {
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-canvas">
      <div className="pointer-events-none absolute -top-32 -left-28 size-[360px] rounded-full bg-[#c4b5fd] opacity-55 blur-[90px]" />
      <div className="pointer-events-none absolute -right-24 -bottom-36 size-80 rounded-full bg-[#fbcfe8] opacity-55 blur-[90px]" />
      <div className="pointer-events-none absolute bottom-16 left-32 size-60 rounded-full bg-[#a7f3d0] opacity-45 blur-[90px]" />
      <div className="absolute top-8 left-9">
        <Logo />
      </div>
      <div className="relative z-10 w-[380px] rounded-3xl border border-line bg-white p-9 shadow-[0_24px_60px_rgba(124,58,237,0.12)]">
        {children}
      </div>
    </div>
  )
}

export function Modal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-[0_24px_60px_rgba(30,27,46,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-extrabold">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink">
            <IconX size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
