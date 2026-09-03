/**
 * WebSocket client.
 *
 * One socket for the whole app, shared by every screen. Components subscribe
 * to event types rather than opening their own connection — several sockets
 * per tab would multiply the server's connection count for no benefit.
 *
 * The important property is that this is an OPTIMISATION, not a dependency.
 * If the socket never connects — a proxy that strips upgrades, a corporate
 * firewall, a host that does not support them — `connected` stays false and
 * the screens fall back to the polling they used before. The app must never
 * be broken by a blocked WebSocket.
 */

const listeners = new Map() // type -> Set<fn>
let socket = null
let retries = 0
let retryTimer = null
let currentRooms = []
let connected = false
const statusListeners = new Set()

// Heartbeat. A connection can die without the browser noticing — a dropped
// wifi link or a middlebox timing out sends no close frame, and the socket
// sits in OPEN forever while nothing arrives. The browser answers protocol
// pings in its network stack without telling JavaScript, so the page cannot
// use those either. Hence an application-level ping we can actually observe:
// no pong inside PONG_TIMEOUT_MS means the connection is gone, close it and
// let the normal reconnect path take over.
const PING_EVERY_MS = 25000
const PONG_TIMEOUT_MS = 10000
let pingTimer = null
let pongTimer = null

function startHeartbeat() {
  stopHeartbeat()
  pingTimer = setInterval(() => {
    if (socket?.readyState !== 1) return
    try {
      socket.send(JSON.stringify({ type: 'ping' }))
    } catch {
      return
    }
    clearTimeout(pongTimer)
    pongTimer = setTimeout(() => {
      // Deliberately close rather than mark offline: closing runs onclose,
      // which is the single place reconnection is handled.
      try { socket?.close() } catch { /* already gone */ }
    }, PONG_TIMEOUT_MS)
  }, PING_EVERY_MS)
}

function stopHeartbeat() {
  clearInterval(pingTimer)
  clearTimeout(pongTimer)
  pingTimer = null
  pongTimer = null
}

const WS_URL = () => {
  const base = import.meta.env.VITE_API_URL
  if (base) return base.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws'
  // Dev: Vite proxies /ws through to the API, so the page's own origin works
  // and there is no second URL to configure.
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws`
}

function setConnected(value) {
  if (connected === value) return
  connected = value
  for (const fn of statusListeners) fn(value)
}

function emit(type, payload) {
  for (const fn of listeners.get(type) || []) {
    try {
      fn(payload)
    } catch (err) {
      // one bad handler must not stop the others from running
      console.error('realtime handler failed', type, err)
    }
  }
}

export function connect(token) {
  if (!token) return
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) return

  try {
    socket = new WebSocket(`${WS_URL()}?token=${encodeURIComponent(token)}`)
  } catch {
    return // fall back to polling
  }

  socket.onopen = () => {
    retries = 0
    setConnected(true)
    startHeartbeat()
    if (currentRooms.length) {
      socket.send(JSON.stringify({ type: 'subscribe', workspaceIds: currentRooms }))
    }
  }

  socket.onmessage = (e) => {
    let msg
    try {
      msg = JSON.parse(e.data)
    } catch {
      return
    }
    if (msg.type === 'pong') {
      clearTimeout(pongTimer)
      return
    }
    emit(msg.type, msg.payload)
  }

  socket.onclose = () => {
    stopHeartbeat()
    setConnected(false)
    socket = null
    // Exponential backoff capped at 30s. Without a cap, a server restart has
    // every open tab hammering it at once the moment it comes back.
    const delay = Math.min(1000 * 2 ** retries, 30000)
    retries++
    clearTimeout(retryTimer)
    retryTimer = setTimeout(() => connect(token), delay)
  }

  socket.onerror = () => {
    // onclose always follows, so reconnection is handled in one place
  }
}

export function disconnect() {
  clearTimeout(retryTimer)
  stopHeartbeat()
  retries = 0
  currentRooms = []
  if (socket) {
    socket.onclose = null // deliberate close: do not reconnect
    socket.close()
    socket = null
  }
  setConnected(false)
}

/** Replace the set of workspaces this client wants events for. */
export function subscribe(workspaceIds) {
  currentRooms = workspaceIds || []
  if (socket?.readyState === 1) {
    socket.send(JSON.stringify({ type: 'subscribe', workspaceIds: currentRooms }))
  }
}

/** Listen for one event type. Returns an unsubscribe function. */
export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set())
  listeners.get(type).add(fn)
  return () => listeners.get(type)?.delete(fn)
}

export function onStatus(fn) {
  statusListeners.add(fn)
  fn(connected)
  return () => statusListeners.delete(fn)
}

export const isConnected = () => connected

// Dev-only handle so the reconnect path can be exercised for real (drop the
// socket, watch it come back) rather than assumed. Stripped from production
// builds — import.meta.env.DEV is a compile-time constant.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__realtime = {
    // drop the connection; the normal backoff brings it back
    kill: () => socket?.close(),
    // simulate a host where WebSockets are blocked outright, to check the app
    // still works on polling alone
    stop: () => disconnect(),
    state: () => ({ connected, readyState: socket?.readyState ?? null, rooms: currentRooms, retries }),
  }
}
