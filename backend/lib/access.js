const prisma = require('./prisma')

// Role ladder. Anything at "admin" or above can see Team Analytics
// and manage members; only "owner" can delete the workspace or change admins.
const RANK = { member: 1, admin: 2, owner: 3 }

const rankOf = (role) => RANK[role] || 0
const isAdmin = (role) => rankOf(role) >= RANK.admin
const isOwner = (role) => role === 'owner'

/** The caller's membership row for a workspace, or null. */
async function getMembership(workspaceId, userId) {
  return prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  })
}

/**
 * Guard used at the top of a route.
 * Returns { membership } on success, or { status, error } to send back.
 * Pass minRole to require admin/owner.
 */
async function requireMember(workspaceId, userId, minRole = 'member') {
  const membership = await getMembership(workspaceId, userId)
  if (!membership) {
    return { status: 404, error: 'Workspace not found' }
  }
  if (rankOf(membership.role) < rankOf(minRole)) {
    return {
      status: 403,
      error: minRole === 'owner' ? 'Only the workspace owner can do that' : 'Admins only',
    }
  }
  return { membership }
}

/** Same, but resolved from a task id. */
async function requireTaskAccess(taskId, userId, minRole = 'member') {
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task) return { status: 404, error: 'Task not found' }
  const check = await requireMember(task.workspaceId, userId, minRole)
  if (check.error) return { status: check.status === 404 ? 403 : check.status, error: check.error }
  return { task, membership: check.membership }
}

module.exports = { getMembership, requireMember, requireTaskAccess, isAdmin, isOwner, rankOf, RANK }
