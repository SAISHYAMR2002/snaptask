const express = require('express')
const prisma = require('../lib/prisma')
const auth = require('../middleware/auth')
const { requireMember } = require('../lib/access')
const { notify, findMentions, APP_URL } = require('../lib/notify')

const router = express.Router()
router.use(auth)

const MESSAGE_INCLUDE = {
  user: { select: { id: true, name: true, avatar: true } },
  task: {
    select: { id: true, title: true, status: true, priority: true, dueDate: true, workspaceId: true },
  },
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
  const messages = await prisma.message.findMany({
    where: {
      channelId: req.params.id,
      ...(after && !isNaN(after) ? { createdAt: { gt: after } } : {}),
    },
    include: MESSAGE_INCLUDE,
    orderBy: { createdAt: 'asc' },
    take: 200,
  })
  res.json({ messages })
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

  res.status(201).json({ message })
})

module.exports = router
