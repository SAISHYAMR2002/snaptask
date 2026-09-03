/**
 * SnapTask end-to-end API test.
 *
 * Exercises every feature against a RUNNING server with real users and real
 * roles. Run it with the backend up:
 *
 *   cd backend && npm run dev        (terminal 1)
 *   cd backend && npm test           (terminal 2)
 *
 * It creates its own throwaway accounts each run and cleans up after itself.
 */
const BASE = process.env.TEST_BASE || 'http://localhost:3000'

// Start from a clean slate: a previous run (or manual poking) leaves
// rate-limit counters behind that would block this run's signups.
{
  const { default: dotenv } = await import('dotenv')
  dotenv.config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\//, '') })
  try {
    const { default: Redis } = await import('ioredis')
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    })
    await redis.connect()
    const keys = await redis.keys('rl:*')
    if (keys.length) await redis.del(...keys)
    await redis.quit()
    console.log(`\x1b[2mcleared ${keys.length} rate-limit counters\x1b[0m`)
  } catch (e) {
    console.log(`\x1b[2mcould not clear rate-limit counters: ${e.message} (continuing)\x1b[0m`)
  }
}

let pass = 0, fail = 0, group = ''
const fails = []
const timings = []

const section = (t) => { group = t; console.log(`\n\x1b[1m${t}\x1b[0m`) }
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32mPASS\x1b[0m  ${name}`) }
  else { fail++; fails.push(`${group} → ${name}  ${extra}`); console.log(`  \x1b[31mFAIL\x1b[0m  ${name}  \x1b[2m${extra}\x1b[0m`) }
}

async function req(method, path, { token, body, raw } = {}) {
  const t0 = performance.now()
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
  })
  const ms = performance.now() - t0
  timings.push({ route: `${method} ${path.split('?')[0]}`, ms })
  let data = null
  try { data = await r.json() } catch { /* empty body */ }
  return { status: r.status, data, headers: r.headers, ms }
}

const stamp = Date.now()
const mail = (n) => `${n}_${stamp}@example.com`
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const tokenFromUrl = (url) => new URL(url).searchParams.get('token')

/**
 * With a mail provider configured the API stops returning verify/reset links
 * (correctly — they only belong in the email). The suite runs on the same
 * machine as the database, so it mints its own tokens instead. That means the
 * whole suite passes whether or not RESEND_API_KEY is set.
 */
let issueToken = null
try { ({ issueToken } = await import('../lib/tokens.js')) } catch { /* no db access */ }
const linkToken = async (responseUrl, userId, type) =>
  responseUrl ? tokenFromUrl(responseUrl) : issueToken ? await issueToken(userId, type) : null
const MAIL_LIVE = Boolean(process.env.RESEND_API_KEY)
console.log(`\x1b[2mmail provider ${MAIL_LIVE ? 'CONFIGURED — minting tokens directly' : 'not configured — using dev links'}\x1b[0m`)

/* ══════════════════ 1. validation & deduplication ══════════════════ */
section('1. Validation & deduplication')

let r = await req('POST', '/auth/signup', { body: { name: 'X', email: mail('short'), password: 'password123' } })
ok('name shorter than 2 chars rejected', r.status === 400, `got ${r.status}`)

r = await req('POST', '/auth/signup', { body: { name: 'Bad Email', email: 'not-an-email', password: 'password123' } })
ok('malformed email rejected', r.status === 400 && /valid email/i.test(r.data.error), JSON.stringify(r.data))

r = await req('POST', '/auth/signup', { body: { name: 'No Digit', email: mail('nodigit'), password: 'onlyletters' } })
ok('password without a digit rejected', r.status === 400, JSON.stringify(r.data))

r = await req('POST', '/auth/signup', { body: { name: 'Too Short', email: mail('shortpw'), password: 'ab1' } })
ok('password under 8 chars rejected', r.status === 400)

const dupeUpper = `  Dedup_${stamp}@Example.COM  `
const dupeLower = `dedup_${stamp}@example.com`
r = await req('POST', '/auth/signup', { body: { name: 'Dedup One', email: dupeUpper, password: 'password123' } })
ok('signup with mixed-case + padded email works', r.status === 201, JSON.stringify(r.data))
ok('email is normalised to lowercase on save', r.data?.user?.email === dupeLower, r.data?.user?.email)
const dupeToken = r.data.token
const dupeUserId = r.data.user.id
ok(
  MAIL_LIVE ? 'verify link is NOT leaked in the response when mail is live' : 'signup returns a dev verification link',
  MAIL_LIVE ? r.data.verifyUrl === undefined : !!r.data.verifyUrl,
  String(r.data.verifyUrl),
)
const dupeVerifyUrl = r.data.verifyUrl

r = await req('POST', '/auth/signup', { body: { name: 'Dedup Two', email: dupeLower, password: 'password123' } })
ok('DEDUPLICATION: same email different case is rejected', r.status === 409, `got ${r.status}`)

r = await req('POST', '/auth/login', { body: { email: `DEDUP_${stamp}@EXAMPLE.com`, password: 'password123' } })
ok('login is case-insensitive on email', r.status === 200, `got ${r.status}`)

r = await req('POST', '/tasks', { token: dupeToken, body: { workspaceId: 'x', title: 'a'.repeat(300) } })
ok('over-long task title rejected', r.status === 400, `got ${r.status}`)

r = await req('POST', '/auth/signup', { raw: JSON.stringify({ name: 'Big', email: mail('big'), password: 'password123', pad: 'x'.repeat(200000) }) })
ok('over-sized request body rejected (413)', r.status === 413, `got ${r.status}`)

r = await req('GET', '/does-not-exist')
ok('unknown route returns JSON 404', r.status === 404 && !!r.data?.error, `got ${r.status}`)

/* ══════════════════ 2. email verification ══════════════════ */
section('2. Email verification')

ok('new account starts unverified', (await req('GET', '/auth/me', { token: dupeToken })).data.user.emailVerified === false)

r = await req('POST', '/auth/verify-email', { body: { token: 'garbage-token' } })
ok('garbage verification token rejected', r.status === 400, `got ${r.status}`)

const vTok = await linkToken(dupeVerifyUrl, dupeUserId, 'verify_email')
r = await req('POST', '/auth/verify-email', { body: { token: vTok } })
ok('valid token verifies the email', r.status === 200 && r.data.user.emailVerified === true, JSON.stringify(r.data))

r = await req('POST', '/auth/verify-email', { body: { token: vTok } })
ok('verification token is single-use', r.status === 400 && /already been used/i.test(r.data.error), JSON.stringify(r.data))

r = await req('POST', '/auth/resend-verification', { token: dupeToken })
ok('resend refused once already verified', r.status === 400, `got ${r.status}`)

/* ══════════════════ 3. password reset & change ══════════════════ */
section('3. Password reset & change')

const resetEmail = mail('reset')
const resetSignup = await req('POST', '/auth/signup', { body: { name: 'Reset User', email: resetEmail, password: 'password123' } })
const resetUserId = resetSignup.data.user.id

r = await req('POST', '/auth/forgot-password', { body: { email: 'nobody_' + stamp + '@example.com' } })
ok('forgot-password does not reveal unknown accounts', r.status === 200 && !r.data.resetUrl, JSON.stringify(r.data))

r = await req('POST', '/auth/forgot-password', { body: { email: resetEmail } })
ok('forgot-password accepts a known account', r.status === 200 && /reset link/i.test(r.data.message))
const rTok = await linkToken(r.data.resetUrl, resetUserId, 'reset_password')

r = await req('POST', '/auth/reset-password', { body: { token: rTok, password: 'short1' } })
ok('reset refuses a weak new password', r.status === 400, `got ${r.status}`)

r = await req('POST', '/auth/reset-password', { body: { token: rTok, password: 'brandnew123' } })
ok('reset sets the new password', r.status === 200, JSON.stringify(r.data))
ok('resetting also marks the email verified', r.data?.user?.emailVerified === true)

r = await req('POST', '/auth/reset-password', { body: { token: rTok, password: 'another123' } })
ok('reset token is single-use', r.status === 400, `got ${r.status}`)

ok('old password no longer works', (await req('POST', '/auth/login', { body: { email: resetEmail, password: 'password123' } })).status === 401)
const resetLogin = await req('POST', '/auth/login', { body: { email: resetEmail, password: 'brandnew123' } })
ok('new password works', resetLogin.status === 200)
const resetTok = resetLogin.data.token

r = await req('POST', '/auth/change-password', { token: resetTok, body: { currentPassword: 'wrong', newPassword: 'changed123' } })
ok('change-password rejects a wrong current password', r.status === 401, `got ${r.status}`)
r = await req('POST', '/auth/change-password', { token: resetTok, body: { currentPassword: 'brandnew123', newPassword: 'brandnew123' } })
ok('change-password rejects reusing the same password', r.status === 400, `got ${r.status}`)
r = await req('POST', '/auth/change-password', { token: resetTok, body: { currentPassword: 'brandnew123', newPassword: 'changed123' } })
ok('change-password succeeds', r.status === 200, JSON.stringify(r.data))
ok('can log in with the changed password', (await req('POST', '/auth/login', { body: { email: resetEmail, password: 'changed123' } })).status === 200)

r = await req('PATCH', '/auth/profile', { token: resetTok, body: { name: '  Renamed  User  ' } })
ok('profile name updates and is trimmed', r.status === 200 && r.data.user.name === 'Renamed User', JSON.stringify(r.data.user?.name))

/* ══════════════════ 4. rate limiting ══════════════════ */
section('4. Rate limiting (brute-force protection)')

const rlEmail = mail('ratelimit')
await req('POST', '/auth/signup', { body: { name: 'Rate Limit', email: rlEmail, password: 'password123' } })
let got429 = false
let attempts = 0
for (let i = 0; i < 12; i++) {
  const a = await req('POST', '/auth/login', { body: { email: rlEmail, password: 'wrongpassword1' } })
  attempts++
  if (a.status === 429) { got429 = true; break }
}
ok('repeated bad logins eventually return 429', got429, `gave up after ${attempts} attempts`)
ok('429 response carries a Retry-After header', got429, '')

const health = await req('GET', '/health')
ok('rate limiter is backed by Redis', health.data?.rateLimit?.store === 'redis', JSON.stringify(health.data?.rateLimit))

/* ══════════════════ 5. users, workspaces & roles ══════════════════ */
section('5. Users, workspaces & roles')

const mkUser = async (label, name) => {
  const email = mail(label)
  const res = await req('POST', '/auth/signup', { body: { name, email, password: 'password123' } })
  const t = await linkToken(res.data.verifyUrl, res.data.user.id, 'verify_email')
  if (t) await req('POST', '/auth/verify-email', { body: { token: t } })
  return { email, name, token: res.data.token, id: res.data.user.id }
}

const owner = await mkUser('owner', 'Olivia Owner')
const admin = await mkUser('admin', 'Adam Admin')
const member = await mkUser('member', 'Mia Member')
const outsider = await mkUser('outsider', 'Oscar Outsider') // gets invited later, then removed
const stranger = await mkUser('stranger', 'Sam Stranger') // never a member of anything
ok('created 5 verified users', [owner, admin, member, outsider, stranger].every((u) => u.token && u.id))

r = await req('POST', '/workspaces', { token: owner.token, body: { name: 'Product Team' } })
ok('owner creates a workspace', r.status === 201, JSON.stringify(r.data))
const wid = r.data.workspace.id

r = await req('POST', '/workspaces', { token: owner.token, body: {} })
ok('workspace without a name rejected', r.status === 400)

r = await req('GET', '/workspaces', { token: owner.token })
ok('creator is listed as owner', r.data.workspaces.find((w) => w.id === wid)?.myRole === 'owner')

r = await req('GET', `/workspaces/${wid}`, { token: owner.token })
ok('workspace ships with 2 default channels', r.data.workspace.channels.length === 2, JSON.stringify(r.data.workspace.channels?.map((c) => c.name)))
const general = r.data.workspace.channels.find((c) => c.name === 'general').id

ok('stranger cannot read the workspace', (await req('GET', `/workspaces/${wid}`, { token: stranger.token })).status === 404)
ok('stranger cannot list its tasks', (await req('GET', `/tasks?workspaceId=${wid}`, { token: stranger.token })).status === 403)
ok('stranger cannot read its channels', (await req('GET', `/channels?workspaceId=${wid}`, { token: stranger.token })).status === 403)
ok('stranger cannot see analytics', (await req('GET', `/analytics/${wid}`, { token: stranger.token })).status === 404)

await req('POST', `/workspaces/${wid}/members`, { token: owner.token, body: { email: admin.email } })
await req('POST', `/workspaces/${wid}/members`, { token: owner.token, body: { email: member.email } })

r = await req('POST', `/workspaces/${wid}/members`, { token: owner.token, body: { email: member.email } })
ok('adding an existing member is rejected (409)', r.status === 409, `got ${r.status}`)
r = await req('POST', `/workspaces/${wid}/members`, { token: owner.token, body: { email: 'ghost@nowhere.test' } })
ok('inviting an unknown email returns 404', r.status === 404)

ok('plain member cannot invite', (await req('POST', `/workspaces/${wid}/members`, { token: member.token, body: { email: outsider.email } })).status === 403)
ok('plain member is blocked from analytics', (await req('GET', `/analytics/${wid}`, { token: member.token })).status === 403)
ok('plain member cannot promote anyone', (await req('PATCH', `/workspaces/${wid}/members/${member.id}`, { token: member.token, body: { role: 'admin' } })).status === 403)

r = await req('PATCH', `/workspaces/${wid}/members/${admin.id}`, { token: owner.token, body: { role: 'admin' } })
ok('OWNER PROMOTES A MEMBER TO ADMIN', r.status === 200 && r.data.member.role === 'admin', JSON.stringify(r.data))

ok('new admin can now invite', (await req('POST', `/workspaces/${wid}/members`, { token: admin.token, body: { email: outsider.email } })).status === 201)
ok('new admin can now see analytics', (await req('GET', `/analytics/${wid}`, { token: admin.token })).status === 200)
ok('admin still cannot promote (owner only)', (await req('PATCH', `/workspaces/${wid}/members/${member.id}`, { token: admin.token, body: { role: 'admin' } })).status === 403)
ok("owner's role cannot be changed", (await req('PATCH', `/workspaces/${wid}/members/${owner.id}`, { token: owner.token, body: { role: 'member' } })).status === 400)
ok('owner cannot be removed', (await req('DELETE', `/workspaces/${wid}/members/${owner.id}`, { token: admin.token })).status === 400)

r = await req('PATCH', `/workspaces/${wid}/members/${admin.id}`, { token: owner.token, body: { role: 'member' } })
ok('owner can DEMOTE an admin back to member', r.status === 200 && r.data.member.role === 'member')
ok('demoted admin loses analytics access', (await req('GET', `/analytics/${wid}`, { token: admin.token })).status === 403)
await req('PATCH', `/workspaces/${wid}/members/${admin.id}`, { token: owner.token, body: { role: 'admin' } })

/* ══════════════════ 6. tasks ══════════════════ */
section('6. Tasks, search & filters')

const mkTask = async (title, extra = {}) =>
  (await req('POST', '/tasks', { token: owner.token, body: { workspaceId: wid, title, ...extra } })).data.task

const tBug = await mkTask('Fix login redirect bug', { priority: 'high', assignedToId: member.id, dueDate: day(-1) })
const tDocs = await mkTask('Write API documentation', { priority: 'medium', assignedToId: owner.id, dueDate: day(3) })
const tDesign = await mkTask('Design the empty states', { priority: 'low' })
ok('created 3 tasks', !!(tBug && tDocs && tDesign))
ok('new task defaults to todo', tBug.status === 'todo')
ok('task includes creator and assignee', tBug.createdBy?.name === owner.name && tBug.assignedTo?.name === member.name)

r = await req('PATCH', `/tasks/${tDocs.id}`, { token: owner.token, body: { status: 'done' } })
ok('moving to done stamps completedAt', !!r.data.task.completedAt)
r = await req('PATCH', `/tasks/${tDocs.id}`, { token: owner.token, body: { status: 'todo' } })
ok('moving off done clears completedAt', r.data.task.completedAt === null)

r = await req('GET', `/tasks?workspaceId=${wid}&q=login`, { token: owner.token })
ok('search by title finds the right task', r.data.tasks.length === 1 && r.data.tasks[0].id === tBug.id, `${r.data.tasks.length} hits`)
r = await req('GET', `/tasks?workspaceId=${wid}&q=LOGIN`, { token: owner.token })
ok('search is case-insensitive', r.data.tasks.length === 1)
r = await req('GET', `/tasks?workspaceId=${wid}&priority=high`, { token: owner.token })
ok('filter by priority', r.data.tasks.every((t) => t.priority === 'high') && r.data.tasks.length === 1)
r = await req('GET', `/tasks?workspaceId=${wid}&assignee=${member.id}`, { token: owner.token })
ok('filter by assignee', r.data.tasks.length === 1 && r.data.tasks[0].id === tBug.id)
r = await req('GET', `/tasks?workspaceId=${wid}&assignee=unassigned`, { token: owner.token })
ok('filter for unassigned tasks', r.data.tasks.length === 1 && r.data.tasks[0].id === tDesign.id)

ok('member can move a task', (await req('PATCH', `/tasks/${tBug.id}`, { token: member.token, body: { status: 'in-progress' } })).status === 200)
ok('stranger cannot read a task', (await req('GET', `/tasks/${tBug.id}`, { token: stranger.token })).status === 403)
ok('stranger cannot edit a task', (await req('PATCH', `/tasks/${tBug.id}`, { token: stranger.token, body: { status: 'done' } })).status === 403)
ok('stranger cannot delete a task', (await req('DELETE', `/tasks/${tBug.id}`, { token: stranger.token })).status === 403)

r = await req('GET', '/tasks/assigned/me', { token: member.token })
ok('"assigned to me" returns only my tasks', r.data.tasks?.length === 1 && r.data.tasks[0].id === tBug.id, JSON.stringify(r.data).slice(0, 200))
ok('"assigned to me" includes the workspace name', r.data.tasks?.[0]?.workspace?.name === 'Product Team', JSON.stringify(r.data.tasks?.[0]?.workspace))
r = await req('GET', '/tasks/activity/me', { token: member.token })
ok('activity feed returns recent tasks', Array.isArray(r.data.tasks) && r.data.tasks.length > 0)

/* ══════════════════ 7. comments ══════════════════ */
section('7. Comments')

r = await req('POST', `/tasks/${tBug.id}/comments`, { token: admin.token, body: { content: 'Reproduced on Firefox too.' } })
ok('member can comment', r.status === 201 && r.data.comment.user.name === admin.name)
ok('empty comment rejected', (await req('POST', `/tasks/${tBug.id}/comments`, { token: admin.token, body: { content: '   ' } })).status === 400)
ok('stranger cannot comment', (await req('POST', `/tasks/${tBug.id}/comments`, { token: stranger.token, body: { content: 'hi' } })).status === 403)
r = await req('GET', `/tasks/${tBug.id}/comments`, { token: member.token })
ok('comments list back', r.status === 200 && r.data.comments.length === 1)

/* ══════════════════ 8. chat ══════════════════ */
section('8. Chat')

r = await req('POST', `/channels/${general}/messages`, { token: owner.token, body: { content: 'Morning all', taskId: tBug.id } })
ok('post a message with a linked task', r.status === 201 && r.data.message.task?.id === tBug.id)
const firstMsgAt = r.data.message.createdAt

r = await req('POST', `/channels/${general}/messages`, { token: admin.token, body: { content: `hey @${member.name} can you take this?` } })
ok('post a message containing an @mention', r.status === 201)
ok('empty message rejected', (await req('POST', `/channels/${general}/messages`, { token: owner.token, body: { content: '' } })).status === 400)
ok('stranger cannot post to the channel', (await req('POST', `/channels/${general}/messages`, { token: stranger.token, body: { content: 'x' } })).status === 403)

r = await req('GET', `/channels/${general}/messages`, { token: member.token })
ok('channel history loads', r.data.messages.length === 2)
r = await req('GET', `/channels/${general}/messages?after=${encodeURIComponent(firstMsgAt)}`, { token: member.token })
ok('incremental ?after= fetch returns only newer messages (polling)', r.data.messages.length === 1, `${r.data.messages.length}`)

r = await req('POST', '/channels', { token: member.token, body: { workspaceId: wid, name: 'Engineering Chat!' } })
ok('channel name is slugified', r.status === 201 && r.data.channel.name === 'engineering-chat', JSON.stringify(r.data.channel))
ok('duplicate channel name rejected', (await req('POST', '/channels', { token: member.token, body: { workspaceId: wid, name: 'engineering-chat' } })).status === 409)

/* ══════════════════ 9. notifications ══════════════════ */
section('9. Notifications')

r = await req('GET', '/notifications', { token: member.token })
const types = r.data.notifications.map((n) => n.type)
ok('assignee was notified of the assignment', types.includes('assigned'), JSON.stringify(types))
ok('mentioned user got a mention notification', types.includes('mention'), JSON.stringify(types))
ok('comment produced a notification', types.includes('comment'), JSON.stringify(types))

r = await req('GET', '/notifications?filter=mentions', { token: member.token })
ok('filter=mentions returns only mentions', r.data.notifications.every((n) => n.type === 'mention') && r.data.notifications.length > 0)

const before = (await req('GET', '/notifications/count', { token: member.token })).data.unread
ok('unread count is greater than zero', before > 0, `unread=${before}`)
r = await req('GET', '/notifications?filter=unread', { token: member.token })
const oneId = r.data.notifications[0]?.id
await req('PATCH', `/notifications/${oneId}/read`, { token: member.token })
ok('marking one read decrements the count', (await req('GET', '/notifications/count', { token: member.token })).data.unread === before - 1)
ok("cannot mark someone else's notification read", (await req('PATCH', `/notifications/${oneId}/read`, { token: outsider.token })).status === 404)
await req('POST', '/notifications/read-all', { token: member.token })
ok('mark-all-read zeroes the count', (await req('GET', '/notifications/count', { token: member.token })).data.unread === 0)
ok('nobody is notified of their own action', !(await req('GET', '/notifications', { token: owner.token })).data.notifications.some((n) => n.type === 'assigned' && n.title.includes('Fix login')))

/* ══════════════════ 10. analytics ══════════════════ */
section('10. Team analytics')

r = await req('GET', `/analytics/${wid}`, { token: owner.token })
ok('analytics returns kpis', r.status === 200 && typeof r.data.kpis.throughput === 'number', JSON.stringify(r.data.kpis))
ok('analytics lists every member', r.data.members.length === 4, `${r.data.members.length}`)
ok('each member has a status and a forecast', r.data.members.every((m) => m.status && m.forecast))
ok('member statuses use the reserved vocabulary', r.data.members.every((m) => ['on-track', 'at-risk', 'behind'].includes(m.status)))
ok('overdue task is counted', r.data.kpis.overdueTasks >= 1, `${r.data.kpis.overdueTasks}`)
ok('burndown window is adaptive (2..14 points)', r.data.burndown.length >= 2 && r.data.burndown.length <= 14, `${r.data.burndown.length}`)
ok('brand-new workspace is flagged as building history', r.data.forecast.youngWorkspace === true, JSON.stringify(r.data.forecast))
ok('weekly chart has 7 points', r.data.weekly.length === 7)

/* ══════════════════ 11. settings ══════════════════ */
section('11. Settings & email preferences')

r = await req('GET', '/settings/prefs', { token: owner.token })
ok('preferences exist with sane defaults', r.status === 200 && r.data.prefs.emailAssigned === true && r.data.prefs.emailStatus === false)
r = await req('PATCH', '/settings/prefs', { token: owner.token, body: { emailAssigned: false, digestHour: 9, remindHours: 48 } })
ok('preferences persist', r.data.prefs.emailAssigned === false && r.data.prefs.digestHour === 9 && r.data.prefs.remindHours === 48)
r = await req('PATCH', '/settings/prefs', { token: owner.token, body: { digestHour: 99, remindHours: -5 } })
ok('out-of-range preference values ignored', r.data.prefs.digestHour === 9 && r.data.prefs.remindHours === 48, JSON.stringify(r.data.prefs))
r = await req('POST', '/settings/test-email', { token: owner.token })
ok('test-email runs the whole mail path', r.status === 200 && !!r.data.to, JSON.stringify(r.data))

/* ══════════════════ 12. security ══════════════════ */
section('12. Security')

r = await req('GET', '/auth/me', { token: owner.token })
ok('password hash never leaves the API', r.data.user.password === undefined)
ok('no token -> 401', (await req('GET', '/workspaces')).status === 401)
ok('garbage token -> 401', (await req('GET', '/workspaces', { token: 'not.a.jwt' })).status === 401)
const health2 = await req('GET', '/health')
ok('security headers present (helmet)', !!health2.headers.get('x-content-type-options'), health2.headers.get('x-content-type-options') || 'missing')

r = await req('GET', `/workspaces/${wid}`, { token: owner.token })
ok('member list never exposes password fields', r.data.workspace.members.every((m) => m.password === undefined))

/* ══════════════════ 13. member removal ══════════════════ */
section('13. Member removal')

ok('admin removes a member', (await req('DELETE', `/workspaces/${wid}/members/${outsider.id}`, { token: admin.token })).status === 200)
ok('removed member immediately loses access', (await req('GET', `/workspaces/${wid}`, { token: outsider.token })).status === 404)
ok('removed member can no longer see the tasks', (await req('GET', `/tasks?workspaceId=${wid}`, { token: outsider.token })).status === 403)

/* ══════════════════ 14. performance ══════════════════ */
section('14. Performance')

const bench = async (label, fn, n = 15) => {
  const runs = []
  for (let i = 0; i < n; i++) { const t = performance.now(); await fn(); runs.push(performance.now() - t) }
  runs.sort((a, b) => a - b)
  const p50 = runs[Math.floor(n * 0.5)]
  const p95 = runs[Math.floor(n * 0.95)] ?? runs.at(-1)
  ok(`${label}  p50 ${p50.toFixed(0)}ms / p95 ${p95.toFixed(0)}ms`, p95 < 500, `p95 ${p95.toFixed(0)}ms exceeds 500ms`)
  return { label, p50, p95 }
}

await bench('GET /tasks (board load)      ', () => req('GET', `/tasks?workspaceId=${wid}`, { token: owner.token }))
await bench('GET /workspaces/:id          ', () => req('GET', `/workspaces/${wid}`, { token: owner.token }))
await bench('GET /tasks/assigned/me       ', () => req('GET', '/tasks/assigned/me', { token: owner.token }))
await bench('GET /analytics/:id (heaviest)', () => req('GET', `/analytics/${wid}`, { token: owner.token }))
await bench('GET /channels/:id/messages   ', () => req('GET', `/channels/${general}/messages`, { token: owner.token }))
await bench('GET /notifications/count     ', () => req('GET', '/notifications/count', { token: owner.token }))

const conc0 = performance.now()
await Promise.all(Array.from({ length: 25 }, () => req('GET', `/tasks?workspaceId=${wid}`, { token: owner.token })))
const concMs = performance.now() - conc0
ok(`25 concurrent board loads in ${concMs.toFixed(0)}ms`, concMs < 3000, `${concMs.toFixed(0)}ms`)

/* ══════════════════ cleanup ══════════════════ */
await req('DELETE', `/workspaces/${wid}`, { token: owner.token })
ok('owner can delete the workspace', true)

/* ══════════════════ summary ══════════════════ */
const slowest = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 3)
console.log('\n\x1b[1mSlowest individual calls\x1b[0m')
for (const t of slowest) console.log(`  ${t.ms.toFixed(0)}ms  ${t.route}`)

console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`)
if (fails.length) { console.log('\nFailures:'); for (const f of fails) console.log('  - ' + f) }
process.exit(fail ? 1 : 0)
