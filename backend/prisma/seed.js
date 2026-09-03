/**
 * Demo data for manual testing.
 *
 *   npm run seed
 *
 * WIPES every row and recreates a realistic workspace with four accounts that
 * cover all three roles, tasks spread across statuses, chat, comments,
 * notifications, and two weeks of backdated completions so the dashboard
 * charts and Team Analytics have real history to draw.
 *
 * Refuses to run against anything that doesn't look like a local database
 * unless you pass --force.
 */
require('dotenv').config()
const bcrypt = require('bcryptjs')
const prisma = require('../lib/prisma')

const PASSWORD = 'password123'
const DOMAIN = 'snaptask.test'
const DAY = 86400000
const ago = (d) => new Date(Date.now() - d * DAY)
const ahead = (d) => new Date(Date.now() + d * DAY)

async function main() {
  const url = process.env.DATABASE_URL || ''
  const isLocal = /localhost|127\.0\.0\.1|snaptask-db/.test(url)
  if (!isLocal && !process.argv.includes('--force')) {
    console.error('\nRefusing to seed: DATABASE_URL does not look local.')
    console.error('This deletes every row. Re-run with --force if you really mean it.\n')
    process.exit(1)
  }

  console.log('Wiping existing data…')
  await prisma.verificationToken.deleteMany()
  await prisma.notification.deleteMany()
  await prisma.message.deleteMany()
  await prisma.comment.deleteMany()
  await prisma.task.deleteMany()
  await prisma.channel.deleteMany()
  await prisma.workspaceMember.deleteMany()
  await prisma.workspace.deleteMany()
  await prisma.notificationPrefs.deleteMany()
  await prisma.user.deleteMany()

  const hash = await bcrypt.hash(PASSWORD, 10)
  const mkUser = (name, handle) =>
    prisma.user.create({
      data: {
        name,
        email: `${handle}@${DOMAIN}`,
        password: hash,
        emailVerified: true, // skip the verify banner for demo accounts
        verifiedAt: ago(30),
        prefs: { create: {} },
      },
    })

  console.log('Creating users…')
  const olivia = await mkUser('Olivia Owner', 'owner')
  const adam = await mkUser('Adam Admin', 'admin')
  const mia = await mkUser('Mia Member', 'member')
  const sam = await mkUser('Sam Stranger', 'stranger')

  console.log('Creating workspaces…')
  const product = await prisma.workspace.create({
    data: {
      name: 'Product Team',
      ownerId: olivia.id,
      createdAt: ago(20),
      members: {
        create: [
          { userId: olivia.id, role: 'owner', joinedAt: ago(20) },
          { userId: adam.id, role: 'admin', joinedAt: ago(18) },
          { userId: mia.id, role: 'member', joinedAt: ago(15) },
        ],
      },
      channels: {
        create: [
          { name: 'general', purpose: 'Everything about this workspace' },
          { name: 'engineering', purpose: 'Backend & API work' },
          { name: 'random', purpose: 'Off-topic' },
        ],
      },
    },
    include: { channels: true },
  })

  // a workspace Sam owns and the others cannot see — proves isolation
  await prisma.workspace.create({
    data: {
      name: 'Marketing (Sam only)',
      ownerId: sam.id,
      members: { create: [{ userId: sam.id, role: 'owner' }] },
      channels: { create: [{ name: 'general' }] },
    },
  })

  console.log('Creating tasks…')
  const task = (t) =>
    prisma.task.create({
      data: { workspaceId: product.id, createdById: olivia.id, ...t },
    })

  const open = [
    { title: 'Fix login redirect bug on refresh', priority: 'high', status: 'in-progress', assignedToId: olivia.id, dueDate: ahead(0), createdAt: ago(4) },
    { title: 'Write API docs for the /tasks endpoints', priority: 'medium', status: 'todo', assignedToId: olivia.id, dueDate: ahead(2), createdAt: ago(6) },
    { title: 'Design empty states for the board', priority: 'medium', status: 'todo', assignedToId: adam.id, dueDate: ahead(3), createdAt: ago(5) },
    { title: 'Add rate limiting to the auth routes', priority: 'high', status: 'todo', assignedToId: adam.id, dueDate: ago(1), createdAt: ago(9) },
    { title: 'Set up analytics events for task actions', priority: 'medium', status: 'in-progress', assignedToId: mia.id, dueDate: ahead(5), createdAt: ago(7) },
    { title: 'Audit colour contrast for accessibility', priority: 'low', status: 'todo', assignedToId: null, dueDate: ahead(9), createdAt: ago(3) },
    { title: 'Decide on a pagination strategy', priority: 'low', status: 'todo', assignedToId: mia.id, dueDate: ago(2), createdAt: ago(11) },
  ]
  const bug = await task(open[0])
  for (const t of open.slice(1)) await task(t)

  // completed work spread over two weeks so the charts are not one lonely bar
  const finished = [
    ['Model the database schema in Prisma', 'high', olivia.id, 12],
    ['Set up Docker Compose for Postgres + Redis', 'low', olivia.id, 11],
    ['Health-check endpoint + CORS setup', 'low', mia.id, 9],
    ['Pick a colour palette', 'low', adam.id, 8],
    ['JWT auth middleware', 'high', olivia.id, 6],
    ['Workspace membership guards', 'high', adam.id, 5],
    ['Task board columns', 'medium', mia.id, 4],
    ['Task detail slide-over', 'medium', adam.id, 3],
    ['Notification inbox', 'medium', olivia.id, 2],
    ['Chat channels', 'medium', mia.id, 1],
    ['Email templates', 'low', adam.id, 1],
  ]
  for (const [title, priority, assignedToId, doneDaysAgo] of finished) {
    await task({
      title,
      priority,
      status: 'done',
      assignedToId,
      createdAt: ago(doneDaysAgo + 4),
      completedAt: ago(doneDaysAgo),
      dueDate: ago(doneDaysAgo - 1),
    })
  }

  console.log('Creating comments…')
  await prisma.comment.createMany({
    data: [
      { taskId: bug.id, userId: adam.id, content: "Reproduced on Firefox too. I'll take the loading state if you take the token read.", createdAt: ago(1) },
      { taskId: bug.id, userId: olivia.id, content: 'On it — moving to In Progress.', createdAt: ago(1) },
      { taskId: bug.id, userId: mia.id, content: 'Shout if you want a second pair of eyes.', createdAt: ago(0) },
    ],
  })

  console.log('Creating chat…')
  const general = product.channels.find((c) => c.name === 'general')
  const engineering = product.channels.find((c) => c.name === 'engineering')
  await prisma.message.createMany({
    data: [
      { channelId: general.id, userId: mia.id, content: 'Morning all. Auth PR is up for review.', createdAt: ago(0.2) },
      { channelId: general.id, userId: adam.id, content: 'Reproduced the redirect bug. @Olivia Owner can you take the token-read part?', createdAt: ago(0.15) },
      { channelId: general.id, userId: olivia.id, content: 'On it. Linking the task so we track it here:', taskId: bug.id, createdAt: ago(0.1) },
      { channelId: engineering.id, userId: adam.id, content: 'Rate limiting is in — Redis backed, 8 attempts per 15 minutes.', createdAt: ago(0.5) },
      { channelId: engineering.id, userId: mia.id, content: 'Nice. Once that lands I will cut a staging deploy.', createdAt: ago(0.4) },
    ],
  })

  console.log('Creating notifications…')
  await prisma.notification.createMany({
    data: [
      { userId: olivia.id, type: 'mention', title: 'Adam Admin mentioned you in #general', body: 'can you take the token-read part?', workspaceId: product.id, channelId: general.id, read: false, createdAt: ago(0.15) },
      { userId: olivia.id, type: 'comment', title: 'Adam Admin commented on "Fix login redirect bug on refresh"', body: 'Reproduced on Firefox too.', taskId: bug.id, workspaceId: product.id, read: false, createdAt: ago(1) },
      { userId: olivia.id, type: 'due', title: '"Fix login redirect bug on refresh" is due today', taskId: bug.id, workspaceId: product.id, read: false, createdAt: ago(0.3) },
      { userId: olivia.id, type: 'status', title: '"Chat channels" moved to done', workspaceId: product.id, read: true, createdAt: ago(1) },
      { userId: adam.id, type: 'overdue', title: '"Add rate limiting to the auth routes" is overdue', taskId: null, workspaceId: product.id, read: false, createdAt: ago(0.5) },
      { userId: mia.id, type: 'assigned', title: 'You were assigned "Set up analytics events for task actions"', workspaceId: product.id, read: false, createdAt: ago(2) },
    ],
  })

  const counts = {
    users: await prisma.user.count(),
    workspaces: await prisma.workspace.count(),
    tasks: await prisma.task.count(),
    messages: await prisma.message.count(),
    notifications: await prisma.notification.count(),
  }

  console.log(`
Done. ${counts.users} users · ${counts.workspaces} workspaces · ${counts.tasks} tasks · ${counts.messages} messages · ${counts.notifications} notifications

  Log in at http://localhost:5173  —  password for every account: ${PASSWORD}

  owner@${DOMAIN}      Olivia Owner    OWNER   full control, can promote/demote
  admin@${DOMAIN}      Adam Admin      ADMIN   sees Team Analytics, can invite
  member@${DOMAIN}     Mia Member      MEMBER  no Team Analytics in her sidebar
  stranger@${DOMAIN}   Sam Stranger    —       different workspace, sees none of this

  Try: log in as member@, note there is no Team Analytics. Then as owner@,
  Members -> change Mia to admin. Refresh her window and it appears.
`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
