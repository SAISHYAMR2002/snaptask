import { useId, useState } from 'react'

/**
 * The charts used on the analytics screens.
 *
 * The version these replace was a row of bare bars: no axis, no scale, no
 * dates, no values, and a 3px stub drawn for every zero day. You could see
 * that something happened more at the right-hand end and nothing else — not
 * how many, not when, not compared to what. Everything here exists to answer
 * one of those questions.
 *
 * Shared rules (from the dataviz guidance):
 *  - one series -> one hue, no legend (the heading names it)
 *  - value labels are SELECTIVE (the peak and the last point), never on every
 *    bar; the axis and the tooltip carry the rest
 *  - gridlines are hairline and recessive, drawn behind the marks
 *  - every mark has a hover tooltip, because an on-screen chart is interactive
 *  - colours come from CSS variables so dark mode is a real palette, not a flip
 */

/**
 * Axis ticks people read at a glance: 0 / 5 / 10, never 0 / 3.33 / 6.67.
 *
 * `integer` matters more than it looks. These axes count TASKS, and the
 * general-purpose stepper happily produced 0 / 0.5 / 1 / 1.5 / 2 — which
 * invites the reader to look for half a task. Whole numbers only when the
 * quantity is a count.
 */
function niceTicks(max, count = 4, integer = false) {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const candidates = integer ? [1, 2, 5, 10, 25, 50] : [1, 2, 2.5, 5, 10]
  const mag = 10 ** Math.floor(Math.log10(raw))
  let step = candidates.map((m) => m * mag).find((s) => s >= raw) || mag * 10
  if (integer) step = Math.max(1, Math.round(step))
  const top = Math.ceil(max / step) * step
  const ticks = []
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Number(v.toFixed(6)))
  return ticks
}

/**
 * How many x labels actually fit, and what they should say.
 *
 * Weekday names are ambiguous over a month ("which Tuesday?") and get
 * ellipsised to a single letter in a narrow slot, which is worse than nothing.
 * Past roughly a fortnight, switch to a compact numeric date and thin the
 * labels to what the width allows.
 */
function xLabels(items, approxWidth = 520) {
  const MIN_LABEL_PX = 34
  const fits = Math.max(2, Math.floor(approxWidth / MIN_LABEL_PX))
  const every = Math.max(1, Math.ceil(items.length / fits))
  const useDates = items.length > 14

  const text = (d) => {
    if (!useDates) return d.label
    const [, m, day] = d.date.split('-')
    return `${Number(m)}/${Number(day)}`
  }

  const out = items.map((d, i) => (i % every === 0 ? text(d) : null))

  // Always label the final bucket — but only if it does not land on top of the
  // previous one. Forcing it unconditionally rendered "9/1 9/3/4" as one blur.
  const last = items.length - 1
  if (out[last] == null) {
    const prev = out.lastIndexOf(out.filter(Boolean).at(-1))
    if (last - prev >= Math.max(2, Math.ceil(every / 2))) out[last] = text(items[last])
  }
  return out
}

function Tooltip({ point }) {
  if (!point) return null
  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg bg-inverse px-2.5 py-1.5 text-[11.5px] font-bold whitespace-nowrap text-inverse-ink shadow-[0_8px_24px_rgba(30,27,46,0.25)]"
      style={{ left: point.x, top: point.y - 8 }}
    >
      {point.label}
    </div>
  )
}

/**
 * Column chart for a count over time.
 * `items` = [{ date, label, count, hours }]
 */
export function TrendColumns({ items = [], unit = 'tasks', height = 150 }) {
  const [hover, setHover] = useState(null)
  const clipId = useId()

  if (!items.length) {
    return <EmptyPlot height={height} message="No data in this range" />
  }

  const total = items.reduce((s, d) => s + d.count, 0)
  if (total === 0) {
    return (
      <EmptyPlot
        height={height}
        message={`Nothing was completed in this range`}
        hint="Try a longer range, or a different sprint."
      />
    )
  }

  const max = Math.max(...items.map((d) => d.count))
  // counts are whole tasks, so the axis must be whole numbers
  const ticks = niceTicks(max, 4, true)
  const top = ticks[ticks.length - 1]

  const PAD_L = 26
  const PAD_B = 22
  const plotH = height - PAD_B
  const peakIndex = items.indexOf(items.reduce((a, b) => (b.count > a.count ? b : a)))
  const labels = xLabels(items)

  return (
    <div className="relative">
      <Tooltip point={hover} />
      <div className="flex" style={{ height }}>
        {/* y axis */}
        <div className="relative shrink-0" style={{ width: PAD_L, height: plotH }}>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-1.5 -translate-y-1/2 text-[9.5px] font-bold text-faint tabular-nums"
              style={{ top: plotH - (t / top) * plotH }}
            >
              {t}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          {/* gridlines sit behind the bars, hairline and recessive */}
          <div className="absolute inset-x-0" style={{ height: plotH }}>
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute inset-x-0 border-t"
                style={{ top: plotH - (t / top) * plotH, borderColor: 'var(--color-chart-grid)' }}
              />
            ))}
          </div>

          {/* bars — 2px gaps so neighbours read as separate without a stroke */}
          <div className="absolute inset-x-0 flex items-end gap-[2px]" style={{ height: plotH }} id={clipId}>
            {items.map((d, i) => {
              const h = (d.count / top) * plotH
              return (
                <div
                  key={d.date}
                  className="group relative flex h-full min-w-0 flex-1 cursor-default items-end justify-center"
                  onMouseEnter={(e) => {
                    const box = e.currentTarget.parentElement.getBoundingClientRect()
                    const own = e.currentTarget.getBoundingClientRect()
                    setHover({
                      x: own.left - box.left + own.width / 2,
                      y: plotH - h,
                      label: `${d.count} ${unit} · ${d.date}${d.hours ? ` · ${d.hours}h` : ''}`,
                    })
                  }}
                  onMouseLeave={() => setHover(null)}
                >
                  {/* a zero day is empty, not a stub: a 3px bar for 0 was a lie */}
                  {d.count > 0 && (
                    <span
                      className="w-full max-w-6 rounded-t-[4px] transition-opacity group-hover:opacity-80"
                      style={{ height: Math.max(h, 2), background: 'var(--color-chart-1)' }}
                    />
                  )}
                  {/* selective direct labels: the peak and the final point only */}
                  {(i === peakIndex || i === items.length - 1) && d.count > 0 && (
                    <span
                      className="absolute text-[9.5px] font-extrabold text-ink-soft tabular-nums"
                      style={{ bottom: Math.max(h, 2) + 2 }}
                    >
                      {d.count}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* x axis — labels are allowed to overflow their own slot so they
              are never ellipsised down to a single letter */}
          <div className="absolute inset-x-0 flex gap-[2px]" style={{ top: plotH, height: PAD_B }}>
            {items.map((d, i) => (
              <span key={d.date} className="relative min-w-0 flex-1">
                {labels[i] && (
                  <span className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[9.5px] font-bold whitespace-nowrap text-faint">
                    {labels[i]}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Burndown: work remaining vs the ideal straight line.
 * Two series, so a legend is required — the caller renders it.
 */
export function BurndownChart({ points = [], height = 170 }) {
  const [hover, setHover] = useState(null)
  if (points.length < 2) return <EmptyPlot height={height} message="Not enough history to draw a burndown" />

  const W = 640
  const PAD_L = 30
  const PAD_R = 8
  const PAD_T = 10
  const PAD_B = 20
  const max = Math.max(...points.map((p) => Math.max(p.remaining, p.ideal)), 1)
  const ticks = niceTicks(max, 3, true)
  const top = ticks[ticks.length - 1]

  const x = (i) => PAD_L + (i * (W - PAD_L - PAD_R)) / (points.length - 1)
  const y = (v) => PAD_T + (1 - v / top) * (height - PAD_T - PAD_B)
  const path = (k) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[k])}`).join(' ')

  const last = points[points.length - 1]
  const labelEvery = Math.max(1, Math.ceil(points.length / 6))

  return (
    <div className="relative">
      {hover && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg bg-inverse px-2.5 py-1.5 text-[11.5px] font-bold whitespace-nowrap text-inverse-ink shadow-[0_8px_24px_rgba(30,27,46,0.25)]"
          style={{ left: `${(hover.i / (points.length - 1)) * 100}%`, top: 0 }}
        >
          {hover.text}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} y1={y(t)} x2={W - PAD_R} y2={y(t)} stroke="var(--color-chart-grid)" strokeWidth="1" />
            <text x={PAD_L - 6} y={y(t) + 3.5} fontSize="9.5" textAnchor="end" className="fill-faint font-bold">
              {t}
            </text>
          </g>
        ))}

        <path d={path('ideal')} fill="none" stroke="var(--color-faint)" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" />
        <path d={path('remaining')} fill="none" stroke="var(--color-chart-1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* end marker with a surface ring so it stays legible over the line */}
        <circle cx={x(points.length - 1)} cy={y(last.remaining)} r="4.5" fill="var(--color-chart-1)" stroke="var(--color-surface)" strokeWidth="2" />
        <text
          x={x(points.length - 1) - 8}
          y={y(last.remaining) - 8}
          fontSize="10"
          textAnchor="end"
          className="fill-ink-soft font-extrabold"
        >
          {last.remaining} left
        </text>

        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.date} x={x(i)} y={height - 4} fontSize="9.5" textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="fill-faint font-bold">
              {p.date.slice(5)}
            </text>
          ) : null,
        )}

        {/* invisible hit strips — a 2px line is far too thin to hover */}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.date}`}
            x={x(i) - (W - PAD_L - PAD_R) / (points.length - 1) / 2}
            y={0}
            width={(W - PAD_L - PAD_R) / (points.length - 1)}
            height={height}
            fill="transparent"
            onMouseEnter={() => setHover({ i, text: `${p.date}: ${p.remaining} open · ideal ${p.ideal}` })}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
    </div>
  )
}

/**
 * Estimate vs actual, per task, as a diverging bar around a zero line.
 *
 * "Above/below a baseline" is exactly what this data is, and the diverging form
 * shows direction and size at once: bars to the right ran over the estimate,
 * bars to the left came in under. A grouped bar chart of two hours-values would
 * make the reader do the subtraction themselves.
 */
export function VarianceBars({ rows = [], height = 22 }) {
  const [hover, setHover] = useState(null)
  if (!rows.length) return null

  const worst = Math.max(...rows.map((r) => Math.abs(r.deltaHours)), 1)

  return (
    <div className="relative flex flex-col gap-1.5">
      <Tooltip point={hover} />
      {rows.map((r) => {
        const over = r.deltaHours > 0
        const pct = (Math.abs(r.deltaHours) / worst) * 50
        return (
          <div
            key={r.id}
            className="flex items-center gap-2.5"
            onMouseEnter={(e) => {
              const box = e.currentTarget.parentElement.getBoundingClientRect()
              const own = e.currentTarget.getBoundingClientRect()
              setHover({
                x: own.left - box.left + own.width / 2,
                y: own.top - box.top,
                label: `${r.title} — estimated ${r.estimateHours}h, took ${r.actualHours}h`,
              })
            }}
            onMouseLeave={() => setHover(null)}
          >
            <span className="w-32 shrink-0 truncate text-[11.5px] font-semibold text-ink-soft sm:w-44">{r.title}</span>

            <span className="relative h-[var(--h)] min-w-0 flex-1 rounded" style={{ '--h': `${height}px`, background: 'var(--color-chart-track)' }}>
              {/* the zero line is the reference — the whole point of the form */}
              <span className="absolute inset-y-0 left-1/2 w-px" style={{ background: 'var(--color-chart-grid)' }} />
              <span
                className="absolute inset-y-[3px] rounded-[3px]"
                style={{
                  left: over ? '50%' : `${50 - pct}%`,
                  width: `${pct}%`,
                  background: over ? 'var(--color-chart-over)' : 'var(--color-chart-under)',
                }}
              />
            </span>

            <span
              className={`w-16 shrink-0 text-right text-[11.5px] font-extrabold tabular-nums ${over ? 'text-danger' : 'text-info'}`}
            >
              {over ? '+' : ''}
              {r.deltaHours}h
            </span>
          </div>
        )
      })}
      <div className="mt-1 flex items-center justify-center gap-4 text-[10.5px] font-bold text-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px]" style={{ background: 'var(--color-chart-under)' }} />
          finished faster
        </span>
        <span>|</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px]" style={{ background: 'var(--color-chart-over)' }} />
          took longer
        </span>
      </div>
    </div>
  )
}

/** A labelled empty plot, so an empty chart still says why it is empty. */
export function EmptyPlot({ height = 150, message, hint }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-center"
      style={{ height, borderColor: 'var(--color-chart-grid)' }}
    >
      <p className="text-[12.5px] font-bold text-muted">{message}</p>
      {hint && <p className="max-w-[24ch] text-[11.5px] text-faint">{hint}</p>}
    </div>
  )
}
