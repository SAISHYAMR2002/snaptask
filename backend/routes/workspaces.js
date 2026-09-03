const express = require('express')
const prisma = require('../lib/prisma')
const auth = require('../middleware/auth')
const { requireMember, rankOf } = require('../lib/access')
const { notify, APP_URL } = require('../lib/notify')

const router = express.Router()
router.use(auth)

const MEMBER_SELECT = {
  id: true,
  role: true,
  joinedAt: true,
  user: { select: { id: true, name: true, email: true, avatar: true } },
}

// flatten { role, user:{...} } into { id, name, email, role } for the frontend
const flatMember = (m) => ({ ...m.user, role: m.role, memberId: m.id, joinedAt: m.joinedAt })

// POST /workspaces  { name }
router.post('/', async (req, res) => {
  const { name } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  const workspace = await prisma.workspace.create({
    data: {
      name,
      ownerId: req.userId,
      // creator joins as owner
      members: { create: { userId: req.userId, role: 'owner' } },
      // every workspace starts with two channels so chat is never empty
      channels: {
        create: [
          { name: 'general', purpose: 'Everything about this workspace' },
          { name: 'random', purpose: 'Off-topic' },
        ],
      },
    },
  })

  res.status(201).json({ workspace })
})

// GET /workspaces  — the workspaces I belong to, with my role
router.get('/', async (req, res) => {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: req.userId },
    include: {
      workspace: { include: { _count: { select: { members: true, tasks: true } } } },
    },
    orderBy: { joinedAt: 'asc' },
  })

  const workspaces = memberships.map((m) => ({ ...m.workspace, myRole: m.role }))
  res.json({ workspaces })
})

// GET /workspaces/:id
router.get('/:id', async (req, res) => {
  const check = await requireMember(req.params.id, req.userId)
  if (check.error) return res.status(check.status).json({ error: check.error })

  const workspace = await prisma.workspace.findUnique({
    where: { id: req.params.id },
    include: {
      members: { select: MEMBER_SELECT, orderBy: { joinedAt: 'asc' } },
      channels: { orderBy: { createdAt: 'asc' } },
    },
  })

  res.json({
    workspace: { ...workspace, members: workspace.members.map(flatMember) },
    myRole: check.membership.role,
  })
})

// POST /workspaces/:id/members  { email }   — admins and the owner
router.post('/:id/members', async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'email is required' })

  const check = await requireMember(req.params.id, req.userId, 'admin')
  if (check.error) return res.status(check.status).json({ error: check.error })

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return res.status(404).json({ error: 'No SnapTask account with that email' })

  const already = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: req.params.id, userId: user.id } },
  })
  if (already) return res.status(409).json({ error: 'They are already a member' })

  const member = await prisma.workspaceMember.create({
    data: { workspaceId: req.params.id, userId: user.id, role: 'member' },
    select: MEMBER_SELECT,
  })

  const ws = await prisma.workspace.findUnique({ where: { id: req.params.id }, select: { name: true } })
  await notify({
    userId: user.id,
    actorId: req.userId,
    type: 'assigned',
    title: `You were added to ${ws.name}`,
    body: 'Open SnapTask to see the board.',
    workspaceId: req.params.id,
    link: `${APP_URL}/workspace/${req.params.id}`,
  })

  res.status(201).json({ member: flatMember(member) })
})

// PATCH /workspaces/:id/members/:userId  { role }  — owner only
router.patch('/:id/members/:userId', async (req, res) => {
  const { role } = req.body
  if (!['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role must be "admin" or "member"' })
  }

  const check = await requireMember(req.params.id, req.userId, 'owner')
  if (check.error) return res.status(check.status).json({ error: check.error })

  const target = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: req.params.id, userId: req.params.userId } },
  })
  if (!target) return res.status(404).json({ error: 'Not a member of this workspace' })
  if (target.role === 'owner') return res.status(400).json({ error: "The owner's role cannot be changed" })

  const member = await prisma.workspaceMember.update({
    where: { id: target.id },
    data: { role },
    select: MEMBER_SELECT,
  })

  const ws = await prisma.workspace.findUnique({ where: { id: req.params.id }, select: { name: true } })
  await notify({
    userId: req.params.userId,
    actorId: req.userId,
    type: 'status',
    title: role === 'admin' ? `You are now an admin of ${ws.name}` : `Your role in ${ws.name} changed to member`,
    body: role === 'admin' ? 'You can now see Team Analytics and manage members.' : null,
    workspaceId: req.params.id,
  })

  res.json({ member: flatMember(member) })
})

// DELETE /workspaces/:id/members/:userId  — admins and the owner
router.delete('/:id/members/:userId', async (req, res) => {
  const check = await requireMember(req.params.id, req.userId, 'admin')
  if (check.error) return res.status(check.status).json({ error: check.error })

  const target = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: req.params.id, userId: req.params.userId } },
  })
  if (!target) return res.status(404).json({ error: 'Not a member of this workspace' })
  if (target.role === 'owner') return res.status(400).json({ error: 'The owner cannot be removed' })
  if (rankOf(target.role) >= rankOf(check.membership.role) && check.membership.role !== 'owner') {
    return res.status(403).json({ error: 'You cannot remove another admin' })
  }

  await prisma.workspaceMember.delete({ where: { id: target.id } })
  res.json({ ok: true })
})

// DELETE /workspaces/:id  — owner only
router.delete('/:id', async (req, res) => {
  const check = await requireMember(req.params.id, req.userId, 'owner')
  if (check.error) return res.status(check.status).json({ error: check.error })
  await prisma.workspace.delete({ where: { id: req.params.id } })
  res.json({ ok: true })
})

module.exports = router
