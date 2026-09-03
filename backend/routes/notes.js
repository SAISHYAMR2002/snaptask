const express = require('express')
const prisma = require('../lib/prisma')
const auth = require('../middleware/auth')
const { requireMember } = require('../lib/access')
const { text } = require('../lib/validate')

const router = express.Router()
router.use(auth)

/**
 * Private notes.
 *
 * A manager keeping observations about the people they work with is normal and
 * useful — "blocked on the API all week", "wants more front-end work", "follow
 * up after leave". The rule that makes it acceptable is that it is genuinely
 * private: not to the subject, not to other admins, not to the workspace owner.
 *
 * That rule is enforced by construction, not by convention:
 *
 *  - EVERY query below filters on `authorId: req.userId`. There is no code path
 *    that reads a note by id without it, so a guessed id returns 404, not
 *    someone else's note.
 *  - There is deliberately NO endpoint that lists notes *about* a person. Such
 *    a route would be one missing filter away from exposing every manager's
 *    notes, and nothing in the product needs it.
 *  - `subject` is included only as {id, name} — never the note author's identity
 *    to anyone else, because nobody else can read the row at all.
 *
 * Workspace membership is still checked: notes live in a workspace, and leaving
 * that workspace should not leave you writing notes in it.
 */

const NOTE_SELECT = {
  id: true,
  body: true,
  remindAt: true,
  remindedAt: true,
  pinned: true,
  createdAt: true,
  updatedAt: true,
  subjectId: true,
  taskId: true,
  subject: { select: { id: true, name: true } },
  task: { select: { id: true, title: true } },
}

// GET /notes?workspaceId=..&subjectId=..   — only ever MY notes
router.get('/', async (req, res) => {
  const { workspaceId, subjectId } = req.query
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' })

  const check = await requireMember(workspaceId, req.userId)
  if (check.error) return res.status(check.status === 404 ? 403 : check.status).json({ error: check.error })

  const notes = await prisma.privateNote.findMany({
    where: {
      authorId: req.userId, // the whole security model, in one line
      workspaceId,
      ...(subjectId ? { subjectId } : {}),
    },
    select: NOTE_SELECT,
    orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    take: 200,
  })

  res.json({ notes })
})

// GET /notes/reminders — my upcoming private reminders, across all workspaces
router.get('/reminders', async (req, res) => {
  const notes = await prisma.privateNote.findMany({
    where: { authorId: req.userId, remindAt: { not: null } },
    select: { ...NOTE_SELECT, workspace: { select: { id: true, name: true } } },
    orderBy: { remindAt: 'asc' },
    take: 50,
  })
  res.json({ notes })
})

// POST /notes  { workspaceId, body, subjectId?, taskId?, remindAt?, pinned? }
router.post('/', async (req, res) => {
  const { workspaceId, subjectId, taskId, remindAt, pinned } = req.body
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' })

  const b = text(req.body.body, { max: 5000, field: 'Note', required: true })
  if (b.error) return res.status(400).json({ error: b.error })

  const check = await requireMember(workspaceId, req.userId)
  if (check.error) return res.status(check.status === 404 ? 403 : check.status).json({ error: check.error })

  // A note may only be about someone in the same workspace — otherwise the
  // subject picker becomes a way to confirm whether an arbitrary user id exists.
  if (subjectId) {
    const subject = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: subjectId } },
    })
    if (!subject) return res.status(400).json({ error: 'That person is not in this workspace' })
  }

  const when = remindAt ? new Date(remindAt) : null
  if (remindAt && isNaN(when)) return res.status(400).json({ error: 'That reminder date is not valid' })

  const note = await prisma.privateNote.create({
    data: {
      body: b.value,
      workspaceId,
      authorId: req.userId,
      subjectId: subjectId || null,
      taskId: taskId || null,
      remindAt: when,
      pinned: Boolean(pinned),
    },
    select: NOTE_SELECT,
  })

  res.status(201).json({ note })
})

// PATCH /notes/:id
router.patch('/:id', async (req, res) => {
  // updateMany with authorId in the filter: a note belonging to someone else
  // matches zero rows rather than throwing a 403 that confirms it exists.
  const data = {}
  if (req.body.body !== undefined) {
    const b = text(req.body.body, { max: 5000, field: 'Note', required: true })
    if (b.error) return res.status(400).json({ error: b.error })
    data.body = b.value
  }
  if (req.body.pinned !== undefined) data.pinned = Boolean(req.body.pinned)
  if (req.body.remindAt !== undefined) {
    if (req.body.remindAt === null || req.body.remindAt === '') {
      data.remindAt = null
      data.remindedAt = null
    } else {
      const when = new Date(req.body.remindAt)
      if (isNaN(when)) return res.status(400).json({ error: 'That reminder date is not valid' })
      data.remindAt = when
      data.remindedAt = null // re-arm: a moved reminder should fire again
    }
  }

  const { count } = await prisma.privateNote.updateMany({
    where: { id: req.params.id, authorId: req.userId },
    data,
  })
  if (!count) return res.status(404).json({ error: 'Note not found' })

  const note = await prisma.privateNote.findUnique({ where: { id: req.params.id }, select: NOTE_SELECT })
  res.json({ note })
})

// DELETE /notes/:id
router.delete('/:id', async (req, res) => {
  const { count } = await prisma.privateNote.deleteMany({
    where: { id: req.params.id, authorId: req.userId },
  })
  if (!count) return res.status(404).json({ error: 'Note not found' })
  res.json({ ok: true })
})

module.exports = router
