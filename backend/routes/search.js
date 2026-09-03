const express = require('express')
const { Prisma } = require('@prisma/client')
const prisma = require('../lib/prisma')
const auth = require('../middleware/auth')

const router = express.Router()
router.use(auth)

/**
 * Global search, backed by the Postgres full-text indexes added in the
 * fulltext_search migration.
 *
 * Two things matter here beyond speed:
 *
 *  1. Scope. Every query is constrained to the workspaces the caller is a
 *     member of, in the SQL itself rather than by filtering afterwards. A
 *     search box that leaks another team's task titles is a data breach, and
 *     filtering in JS is one forgotten line away from being one.
 *
 *  2. Search-as-you-type. Full-text search matches whole lexemes, so a plain
 *     websearch_to_tsquery('depl') finds nothing even though "deploy" is right
 *     there - you would have to finish the word before seeing a result. The
 *     term you are still typing therefore gets a `:*` prefix marker, which
 *     to_tsquery understands and the GIN index can still serve.
 */

/**
 * Turn raw user input into a safe tsquery string.
 *
 * to_tsquery takes operators (& | ! :*) and *throws* on malformed input, so
 * user text can never be passed to it directly - "foo & " or an unbalanced
 * bracket would 500 the endpoint. Reducing to alphanumeric tokens and joining
 * them ourselves means there is nothing left to malform.
 *
 * The last token gets `:*` so it matches as a prefix while it is being typed.
 */
function buildTsQuery(raw) {
  const tokens = String(raw).toLowerCase().match(/[a-z0-9]+/g) || []
  if (!tokens.length) return null
  return tokens.map((t, i) => (i === tokens.length - 1 ? `${t}:*` : t)).join(' & ')
}

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim()
  const limit = Math.min(Number(req.query.limit) || 8, 25)
  const scopeId = req.query.workspaceId || null

  if (!q) return res.json({ query: '', tasks: [], messages: [], comments: [], workspaces: [], channels: [] })

  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: req.userId },
    select: { workspaceId: true },
  })
  let ids = memberships.map((m) => m.workspaceId)
  if (scopeId) ids = ids.filter((id) => id === scopeId)

  const tsString = buildTsQuery(q)
  if (!ids.length || !tsString) {
    return res.json({ query: q, tasks: [], messages: [], comments: [], workspaces: [], channels: [] })
  }

  const tsq = Prisma.sql`to_tsquery('english', ${tsString})`
  // ILIKE catches what stemming cannot: partial words mid-token ("ccess" in
  // "accessibility"). The pg_trgm index on Task.title is what makes it cheap.
  const like = `%${q}%`

  const tasks = await prisma.$queryRaw`
        SELECT t."id", t."title", t."status", t."priority", t."workspaceId", t."dueDate",
               w."name" AS "workspaceName",
               u."name" AS "assigneeName",
               ts_rank(t."searchVector", ${tsq}) AS "rank"
        FROM "Task" t
        JOIN "Workspace" w ON w."id" = t."workspaceId"
        LEFT JOIN "User" u ON u."id" = t."assignedToId"
        WHERE t."workspaceId" IN (${Prisma.join(ids)})
          AND (t."searchVector" @@ ${tsq} OR t."title" ILIKE ${like})
        ORDER BY "rank" DESC, t."updatedAt" DESC
        LIMIT ${limit}`

  // ts_headline returns the matching fragment with the hit marked, so the
  // palette can show *why* a message matched instead of its first 14 words.
  const HEADLINE = 'MaxWords=14, MinWords=5, ShortWord=2, HighlightAll=false, StartSel=<<, StopSel=>>'

  const [messages, comments] = await Promise.all([
    prisma.$queryRaw`
      SELECT m."id", m."createdAt", m."channelId",
             c."name" AS "channelName", c."workspaceId",
             u."name" AS "authorName",
             ts_headline('english', m."content", ${tsq}, ${HEADLINE}) AS "snippet",
             ts_rank(m."searchVector", ${tsq}) AS "rank"
      FROM "Message" m
      JOIN "Channel" c ON c."id" = m."channelId"
      JOIN "User" u ON u."id" = m."userId"
      WHERE c."workspaceId" IN (${Prisma.join(ids)}) AND m."searchVector" @@ ${tsq}
      ORDER BY "rank" DESC, m."createdAt" DESC
      LIMIT ${limit}`,

    prisma.$queryRaw`
      SELECT cm."id", cm."createdAt", cm."taskId",
             t."title" AS "taskTitle", t."workspaceId",
             u."name" AS "authorName",
             ts_headline('english', cm."content", ${tsq}, ${HEADLINE}) AS "snippet",
             ts_rank(cm."searchVector", ${tsq}) AS "rank"
      FROM "Comment" cm
      JOIN "Task" t ON t."id" = cm."taskId"
      JOIN "User" u ON u."id" = cm."userId"
      WHERE t."workspaceId" IN (${Prisma.join(ids)}) AND cm."searchVector" @@ ${tsq}
      ORDER BY "rank" DESC, cm."createdAt" DESC
      LIMIT ${limit}`,
  ])

  // Workspaces and channels are small lists; a plain contains match is right.
  const [workspaces, channels] = await Promise.all([
    prisma.workspace.findMany({
      where: { id: { in: ids }, name: { contains: q, mode: 'insensitive' } },
      select: { id: true, name: true },
      take: limit,
    }),
    prisma.channel.findMany({
      where: { workspaceId: { in: ids }, name: { contains: q, mode: 'insensitive' } },
      select: { id: true, name: true, workspaceId: true },
      take: limit,
    }),
  ])

  res.json({
    query: q,
    // ts_rank comes back as a JS number already; round it so the payload is tidy
    tasks: tasks.map((t) => ({ ...t, rank: Math.round(t.rank * 10000) / 10000 })),
    messages: messages.map((m) => ({ ...m, rank: Math.round(m.rank * 10000) / 10000 })),
    comments: comments.map((c) => ({ ...c, rank: Math.round(c.rank * 10000) / 10000 })),
    workspaces,
    channels,
  })
})

module.exports = router
