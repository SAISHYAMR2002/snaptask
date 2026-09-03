const express = require('express')
const prisma = require('../lib/prisma')
const auth = require('../middleware/auth')

const router = express.Router()
router.use(auth)

// GET /notifications?filter=all|unread|mentions
router.get('/', async (req, res) => {
  const { filter } = req.query
  const where = { userId: req.userId }
  if (filter === 'unread') where.read = false
  if (filter === 'mentions') where.type = 'mention'

  const notifications = await prisma.notification.findMany({
    where,
    include: { task: { select: { id: true, title: true, workspaceId: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  const unread = await prisma.notification.count({ where: { userId: req.userId, read: false } })
  res.json({ notifications, unread })
})

// GET /notifications/count — just the badge number
router.get('/count', async (req, res) => {
  const unread = await prisma.notification.count({ where: { userId: req.userId, read: false } })
  res.json({ unread })
})

// PATCH /notifications/:id/read
router.patch('/:id/read', async (req, res) => {
  const n = await prisma.notification.findUnique({ where: { id: req.params.id } })
  if (!n || n.userId !== req.userId) return res.status(404).json({ error: 'Notification not found' })
  const updated = await prisma.notification.update({ where: { id: n.id }, data: { read: true } })
  res.json({ notification: updated })
})

// POST /notifications/read-all
router.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.userId, read: false },
    data: { read: true },
  })
  res.json({ ok: true })
})

module.exports = router
