const express = require('express')
const prisma = require('../lib/prisma')
const auth = require('../middleware/auth')
const { requireMember } = require('../lib/access')
const { notify, findMentions, APP_URL } = require('../lib/notify')
const { setEphemeral, getEphemeral } = require('../lib/ratelimit')

const router = express.Router()
router.use(auth)

const MESSAGE_INCLUDE = {
  user: { select: { id: true, name: true, avatar: true } },
  task: {
    select: { id: true, title: true, status: true, priority: true, dueDate: true, workspaceId: true },
  },
  reactions: { include: { user: { select: { id: true, name: true } } } },
  poll: {
    include: {
      options: {
        orderBy: { position: 'asc' },
        include: { votes: { include: { user: { select: { id: true, name: true } } } } },
      },
    },
  },
}

/** Collapse raw reaction rows into { emoji, count, mine, names } for the UI. */
function shapeMessage(m, userId) {
  const byEmoji = new Map()
  for (const r of m.reactions || []) {
    const e = byEmoji.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false, names: [] }
    e.count++
    e.names.push(r.user.name)
    if (r.userId === userId) e.mine = true
    byEmoji.set(r.emoji, e)
  }

  let poll = null
  if (m.poll) {
    const totals = m.poll.options.map((o) => o.votes.length)
    const total = totals.reduce((a, b) => a + b, 0)
    poll = {
      id: m.poll.id,
      question: m.poll.question,
      multiple: m.poll.multiple,
      totalVotes: total,
      options: m.poll.options.map((o) => ({
        id: o.id,
        text: o.text,
        votes: o.votes.length,
        pct: total ? Math.round((o.votes.length / total) * 100) : 0,
        mine: o.votes.some((v) => v.userId === userId),
        voters: o.votes.map((v) => v.user.name),
      })),
    }
  }

  const { reactions, poll: _raw, ...rest } = m
  return { ...rest, reactions: [...byEmoji.values()], poll }
}

// GET /channels?workspaceId=...
router.get('/', async (req, res) => {
  const { workspaceId } = req.query
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId query param is required' })

  const check = await requireMember(workspaceId, req.userId)
  if (check.error) return res.status(check.status === 404 ? 403 : check.status).json({ error: check.error })

  const channels = await prisma.channel.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'asc' },
  })
  res.json({ channels })
})

// POST /channels  { workspaceId, name, purpose? }
router.post('/', async (req, res) => {
  const { workspaceId, name, purpose } = req.body
  if (!workspaceId || !name) return res.status(400).json({ error: 'workspaceId and name are required' })

  const check = await requireMember(workspaceId, req.userId)
  if (check.error) return res.status(check.status === 404 ? 403 : check.status).json({ error: check.error })

  const clean = name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-|-$/g, '')
  if (!clean) return res.status(400).json({ error: 'That channel name is not usable' })

  const exists = await prisma.channel.findUnique({
    where: { workspaceId_name: { workspaceId, name: clean } },
  })
  if (exists) return res.status(409).json({ error: 'A channel with that name already exists' })

  const channel = await prisma.channel.create({
    data: { workspaceId, name: clean, purpose: purpose?.trim() || null },
  })
  res.status(201).json({ channel })
})

/** Load a channel and check the caller belongs to its workspace. */
async function loadChannel(channelId, userId) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } })
  if (!channel) return { status: 404, error: 'Channel not found' }
  const check = await requireMember(channel.workspaceId, userId)
  if (check.error) return { status: 403, error: 'Not allowed' }
  return { channel, membership: check.membership }
}

// GET /channels/:id/messages?after=<ISO>   (the frontend polls with `after` for new ones)
router.get('/:id/messages', async (req, res) => {
  const result = await loadChannel(req.params.id, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })

  const after = req.query.after ? new Date(req.query.after) : null
  const incremental = after && !isNaN(after)

  const messages = await prisma.message.findMany({
    where: { channelId: req.params.id, ...(incremental ? { createdAt: { gt: after } } : {}) },
    include: MESSAGE_INCLUDE,
    orderBy: { createdAt: 'asc' },
    take: 200,
  })

  // Reactions and votes change without a new message arriving, so an
  // incremental poll also returns the recent messages' current state.
  let updated = []
  if (incremental) {
    const recent = await prisma.message.findMany({
      where: { channelId: req.params.id, createdAt: { lte: after } },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 30,
    })
    updated = recent.reverse().map((m) => shapeMessage(m, req.userId))
  }

  // who is typing right now, and how far everyone has read
  const [typing, reads] = await Promise.all([
    getEphemeral(`typing:${req.params.id}:`),
    prisma.channelRead.findMany({
      where: { channelId: req.params.id },
      include: { user: { select: { id: true, name: true } } },
    }),
  ])

  res.json({
    messages: messages.map((m) => shapeMessage(m, req.userId)),
    updated,
    typing: typing.filter((t) => t.key !== req.userId).map((t) => t.value),
    reads: reads.map((r) => ({ userId: r.userId, name: r.user.name, lastReadAt: r.lastReadAt })),
  })
})

// POST /channels/:id/typing — refreshes a 6s marker; the client re-pings while typing
router.post('/:id/typing', async (req, res) => {
  const result = await loadChannel(req.params.id, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })
  const me = await prisma.user.findUnique({ where: { id: req.userId }, select: { name: true } })
  await setEphemeral(`typing:${req.params.id}:${req.userId}`, me.name, 6)
  res.json({ ok: true })
})

// POST /channels/:id/read — mark this channel read up to now
router.post('/:id/read', async (req, res) => {
  const result = await loadChannel(req.params.id, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })
  const read = await prisma.channelRead.upsert({
    where: { channelId_userId: { channelId: req.params.id, userId: req.userId } },
    create: { channelId: req.params.id, userId: req.userId },
    update: { lastReadAt: new Date() },
  })
  res.json({ read })
})

/* ---------------- reactions ---------------- */

// POST /channels/messages/:messageId/reactions  { emoji }  — toggles
router.post('/messages/:messageId/reactions', async (req, res) => {
  const emoji = String(req.body.emoji || '').trim()
  if (!emoji || emoji.length > 16) return res.status(400).json({ error: 'emoji is required' })

  const message = await prisma.message.findUnique({ where: { id: req.params.messageId } })
  if (!message) return res.status(404).json({ error: 'Message not found' })
  const channel = await prisma.channel.findUnique({ where: { id: message.channelId } })
  const check = await requireMember(channel.workspaceId, req.userId)
  if (check.error) return res.status(403).json({ error: 'Not allowed' })

  const existing = await prisma.reaction.findUnique({
    where: { messageId_userId_emoji: { messageId: message.id, userId: req.userId, emoji } },
  })
  if (existing) await prisma.reaction.delete({ where: { id: existing.id } })
  else await prisma.reaction.create({ data: { messageId: message.id, userId: req.userId, emoji } })

  const fresh = await prisma.message.findUnique({ where: { id: message.id }, include: MESSAGE_INCLUDE })
  res.json({ message: shapeMessage(fresh, req.userId), removed: Boolean(existing) })
})

/* ---------------- polls ---------------- */

// POST /channels/:id/polls  { question, options[], multiple? }
router.post('/:id/polls', async (req, res) => {
  const result = await loadChannel(req.params.id, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })

  const question = String(req.body.question || '').trim()
  const options = (req.body.options || []).map((o) => String(o || '').trim()).filter(Boolean)
  if (!question) return res.status(400).json({ error: 'question is required' })
  if (options.length < 2) return res.status(400).json({ error: 'a poll needs at least 2 options' })
  if (options.length > 10) return res.status(400).json({ error: 'a poll can have at most 10 options' })

  const message = await prisma.message.create({
    data: {
      channelId: req.params.id,
      userId: req.userId,
      content: question,
      poll: {
        create: {
          question,
          multiple: Boolean(req.body.multiple),
          createdById: req.userId,
          options: { create: options.map((text, position) => ({ text, position })) },
        },
      },
    },
    include: MESSAGE_INCLUDE,
  })

  res.status(201).json({ message: shapeMessage(message, req.userId) })
})

// POST /channels/polls/:pollId/vote  { optionId }
router.post('/polls/:pollId/vote', async (req, res) => {
  const poll = await prisma.poll.findUnique({
    where: { id: req.params.pollId },
    include: { options: true, message: true },
  })
  if (!poll) return res.status(404).json({ error: 'Poll not found' })

  const channel = await prisma.channel.findUnique({ where: { id: poll.message.channelId } })
  const check = await requireMember(channel.workspaceId, req.userId)
  if (check.error) return res.status(403).json({ error: 'Not allowed' })

  const option = poll.options.find((o) => o.id === req.body.optionId)
  if (!option) return res.status(400).json({ error: 'That option is not on this poll' })

  const optionIds = poll.options.map((o) => o.id)
  const mine = await prisma.pollVote.findMany({
    where: { userId: req.userId, optionId: { in: optionIds } },
  })
  const already = mine.find((v) => v.optionId === option.id)

  if (already) {
    await prisma.pollVote.delete({ where: { id: already.id } }) // clicking again un-votes
  } else {
    // single-choice polls replace the previous answer
    if (!poll.multiple && mine.length) {
      await prisma.pollVote.deleteMany({ where: { id: { in: mine.map((v) => v.id) } } })
    }
    await prisma.pollVote.create({ data: { optionId: option.id, userId: req.userId } })
  }

  const fresh = await prisma.message.findUnique({
    where: { id: poll.messageId },
    include: MESSAGE_INCLUDE,
  })
  res.json({ message: shapeMessage(fresh, req.userId) })
})

// POST /channels/:id/messages  { content, taskId? }
router.post('/:id/messages', async (req, res) => {
  const { content, taskId } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'content is required' })

  const result = await loadChannel(req.params.id, req.userId)
  if (result.error) return res.status(result.status).json({ error: result.error })
  const { channel } = result

  const message = await prisma.message.create({
    data: {
      content: content.trim(),
      channelId: channel.id,
      userId: req.userId,
      taskId: taskId || null,
    },
    include: MESSAGE_INCLUDE,
  })

  // @mentions -> notify those members
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: channel.workspaceId },
    include: { user: { select: { id: true, name: true } } },
  })
  const mentioned = findMentions(message.content, members.map((m) => m.user))
  for (const userId of mentioned) {
    await notify({
      userId,
      actorId: req.userId,
      type: 'mention',
      title: `${message.user.name} mentioned you in #${channel.name}`,
      body: message.content.slice(0, 140),
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      link: `${APP_URL}/workspace/${channel.workspaceId}/chat/${channel.id}`,
    })
  }

  res.status(201).json({ message: shapeMessage(message, req.userId) })
})

module.exports = router
