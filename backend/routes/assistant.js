const express = require('express')
const auth = require('../middleware/auth')
const { requireMember } = require('../lib/access')
const { answer, SUGGESTIONS } = require('../lib/assistant')
const { text } = require('../lib/validate')

const router = express.Router()
router.use(auth)

// GET /assistant/suggestions — starter questions for the empty state
router.get('/suggestions', (req, res) => res.json({ suggestions: SUGGESTIONS }))

// POST /assistant/:workspaceId/ask  { question }
router.post('/:workspaceId/ask', async (req, res) => {
  const q = text(req.body.question, { max: 500, field: 'Question', required: true })
  if (q.error) return res.status(400).json({ error: q.error })

  // any member can ask; the answer only ever covers this workspace
  const check = await requireMember(req.params.workspaceId, req.userId)
  if (check.error) return res.status(check.status).json({ error: check.error })

  const result = await answer({
    workspaceId: req.params.workspaceId,
    userId: req.userId,
    question: q.value,
  })

  res.json({ question: q.value, ...result })
})

module.exports = router
