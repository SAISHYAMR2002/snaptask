const { WebSocketServer } = require('ws')
const jwt = require('jsonwebtoken')
const prisma = require('./prisma')
const { logger } = require('./logger')

/**
 * Realtime updates over WebSockets.
 *
 * This replaces a 3-second poll. The poll was not just slow — with N people in
 * a channel it was N requests every 3 seconds whether or not anything had
 * happened, which is the shape of load that gets a free-tier database
 * throttled. A socket costs one connection and sends only when there is news.
 *
 * Design notes:
 *
 * - Rooms are keyed by workspace, not by channel. Task updates, notifications
 *   and chat all matter to the same set of people, so one subscription covers
 *   every live surface in the app.
 *
 * - Membership is checked when a client subscribes, and the socket only ever
 *   receives rooms it was admitted to. Authorisation is not re-done per
 *   message, so a user removed from a workspace mid-session keeps receiving
 *   until they reconnect; that is an accepted trade (the REST API still
 *   refuses them, so they can see but not act) rather than an oversight.
 *
 * - Broadcasting is fire-and-forget and never awaited by a route. A slow or
 *   dead socket must not make someone else's POST take longer.
 */

// workspaceId -> Set<ws>
const rooms = new Map()
let wss = null

function join(workspaceId, socket) {
  if (!rooms.has(workspaceId)) rooms.set(workspaceId, new Set())
  rooms.get(workspaceId).add(socket)
  socket.rooms.add(workspaceId)
}

function leaveAll(socket) {
  for (const id of socket.rooms) {
    const set = rooms.get(id)
    if (!set) continue
    set.delete(socket)
    if (!set.size) rooms.delete(id)
  }
  socket.rooms.clear()
}

/**
 * Send an event to everyone in a workspace.
 * `exceptUserId` skips the person who caused it — they already updated their
 * own UI optimistically, and echoing it back makes the message flicker.
 */
function broadcast(workspaceId, type, payload, exceptUserId = null) {
  const set = rooms.get(workspaceId)
  if (!set?.size) return

  const frame = JSON.stringify({ type, payload })
  for (const socket of set) {
    if (socket.readyState !== 1) continue // 1 === OPEN
    if (exceptUserId && socket.userId === exceptUserId) continue
    try {
      socket.send(frame)
    } catch (err) {
      logger.warn('websocket send failed', { component: 'realtime', err: err.message })
    }
  }
}

/**
 * Send to one person, on every device they have open.
 *
 * Rooms are per-workspace, so a notification addressed to one member would
 * otherwise have to be broadcast to the whole team and filtered client-side —
 * which is not filtering at all, since the frame still arrives on their
 * machine. This walks the connected sockets instead and sends only to theirs.
 */
function sendToUser(userId, type, payload) {
  if (!wss || !userId) return
  const frame = JSON.stringify({ type, payload })
  for (const socket of wss.clients) {
    if (socket.userId !== userId || socket.readyState !== 1) continue
    try {
      socket.send(frame)
    } catch (err) {
      logger.warn('websocket send failed', { component: 'realtime', err: err.message })
    }
  }
}

function attach(server) {
  // noServer + a manual upgrade handler, so a bad token is rejected during the
  // HTTP handshake rather than by opening a socket and closing it afterwards.
  wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    let url
    try {
      url = new URL(req.url, `http://${req.headers.host}`)
    } catch {
      return socket.destroy()
    }
    if (url.pathname !== '/ws') return socket.destroy()

    // The browser WebSocket API cannot set headers, so the token comes as a
    // query param. It is a same-origin URL and never logged (the request
    // logger strips query strings) but it is still the weakest part of this
    // design, and the reason the token is verified before anything is opened.
    const token = url.searchParams.get('token')
    let userId
    try {
      userId = jwt.verify(token, process.env.JWT_SECRET).userId
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      return socket.destroy()
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = userId
      ws.rooms = new Set()
      ws.isAlive = true
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', (ws) => {
    ws.on('pong', () => { ws.isAlive = true })

    ws.on('message', async (raw) => {
      let msg
      try {
        msg = JSON.parse(raw)
      } catch {
        return
      }

      // Application-level heartbeat. The server already pings at the protocol
      // level, but browsers answer those in the network stack without telling
      // JavaScript, so a page cannot use them to tell whether it is still
      // connected. This gives the client something it can actually observe.
      if (msg.type === 'ping') {
        try { ws.send(JSON.stringify({ type: 'pong' })) } catch { /* closing */ }
        return
      }

      if (msg.type === 'subscribe') {
        // Only rooms this user actually belongs to. Asking the database once
        // per subscribe is cheap and is the only thing standing between a
        // crafted frame and another team's messages.
        const memberships = await prisma.workspaceMember.findMany({
          where: { userId: ws.userId },
          select: { workspaceId: true },
        })
        const allowed = new Set(memberships.map((m) => m.workspaceId))
        const wanted = Array.isArray(msg.workspaceIds) ? msg.workspaceIds : []

        leaveAll(ws)
        for (const id of wanted) if (allowed.has(id)) join(id, ws)

        ws.send(JSON.stringify({ type: 'subscribed', payload: { rooms: [...ws.rooms] } }))
      }
    })

    ws.on('close', () => leaveAll(ws))
    ws.on('error', () => leaveAll(ws))
  })

  // A dropped connection (laptop lid, tunnel, phone losing signal) often does
  // not fire 'close'. Without this the room set grows forever and we broadcast
  // into sockets nobody is listening to.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        leaveAll(ws)
        ws.terminate()
        continue
      }
      ws.isAlive = false
      try { ws.ping() } catch { /* terminated below on the next sweep */ }
    }
  }, 30000)
  heartbeat.unref()

  logger.info('websocket server attached at /ws', { component: 'realtime' })
  return wss
}

const stats = () => ({
  enabled: Boolean(wss),
  clients: wss ? wss.clients.size : 0,
  rooms: rooms.size,
})

module.exports = { attach, broadcast, sendToUser, stats }
