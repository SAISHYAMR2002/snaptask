import { Component } from 'react'
import { reportError } from '../lib/observability'
import { Button, Logo } from './ui'

/**
 * Catches render-time crashes.
 *
 * Without this, one bad component unmounts the entire React tree and the user
 * gets a white page with no explanation and no way forward — which is exactly
 * how the earlier hook-order bug presented, and why it was reported as "the
 * app freezes" rather than as a crash.
 *
 * Must be a class: there is still no hook equivalent of componentDidCatch.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    reportError(error, { componentStack: info?.componentStack })
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="grid h-full place-items-center bg-canvas p-6">
        <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-[0_20px_50px_rgba(124,58,237,0.10)]">
          <div className="mb-5 flex justify-center">
            <Logo />
          </div>
          <h1 className="font-display text-lg font-extrabold">This page hit a problem</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Something in the interface crashed. Your work is saved — nothing here was lost.
          </p>

          {/* The message is genuinely useful when someone reports the problem,
              but it is noise for everyone else, so it stays folded away. */}
          <details className="mt-4 text-left">
            <summary className="cursor-pointer text-[12px] font-bold text-faint">
              Technical details
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-surface-2 p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-muted">
              {String(this.state.error?.message || this.state.error)}
            </pre>
          </details>

          <div className="mt-6 flex justify-center gap-2">
            <Button onClick={() => this.setState({ error: null })}>Try again</Button>
            <Button variant="ghost" onClick={() => { window.location.href = '/' }}>
              Back to dashboard
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
