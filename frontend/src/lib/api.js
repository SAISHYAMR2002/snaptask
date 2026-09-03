import axios from 'axios'

// In dev this hits the Vite proxy (/api -> http://localhost:3000).
// In production set VITE_API_URL to the deployed backend URL.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
})

// Attach the saved JWT to every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('snaptask_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

const data = (r) => r.data

// --- auth ---
export const authSignup = (name, email, password) =>
  api.post('/auth/signup', { name, email, password }).then(data)
export const authLogin = (email, password) => api.post('/auth/login', { email, password }).then(data)
export const authMe = () => api.get('/auth/me').then((r) => r.data.user)
export const updateProfile = (name) => api.patch('/auth/profile', { name }).then((r) => r.data.user)

// --- email verification & password reset ---
export const verifyEmail = (token) => api.post('/auth/verify-email', { token }).then(data)
export const resendVerification = () => api.post('/auth/resend-verification').then(data)
export const forgotPassword = (email) => api.post('/auth/forgot-password', { email }).then(data)
export const resetPassword = (token, password) =>
  api.post('/auth/reset-password', { token, password }).then(data)
export const changePassword = (currentPassword, newPassword) =>
  api.post('/auth/change-password', { currentPassword, newPassword }).then(data)

// --- workspaces & members ---
export const getWorkspaces = () => api.get('/workspaces').then((r) => r.data.workspaces)
export const getWorkspace = (id) => api.get(`/workspaces/${id}`).then(data) // { workspace, myRole }
export const createWorkspace = (name) => api.post('/workspaces', { name }).then((r) => r.data.workspace)
export const deleteWorkspace = (id) => api.delete(`/workspaces/${id}`).then(data)
export const addMember = (workspaceId, email) =>
  api.post(`/workspaces/${workspaceId}/members`, { email }).then((r) => r.data.member)
export const setMemberRole = (workspaceId, userId, role) =>
  api.patch(`/workspaces/${workspaceId}/members/${userId}`, { role }).then((r) => r.data.member)
export const removeMember = (workspaceId, userId) =>
  api.delete(`/workspaces/${workspaceId}/members/${userId}`).then(data)

// --- tasks ---
export const getTasks = (workspaceId, filters = {}) =>
  api
    .get('/tasks', {
      params: Object.fromEntries(
        Object.entries({ workspaceId, ...filters }).filter(([, v]) => v !== '' && v != null),
      ),
    })
    .then((r) => r.data.tasks)
export const getMyTasks = () => api.get('/tasks/assigned/me').then((r) => r.data.tasks)
export const getMyActivity = () => api.get('/tasks/activity/me').then((r) => r.data.tasks)
export const createTask = (payload) => api.post('/tasks', payload).then((r) => r.data.task)
export const updateTask = (id, patch) => api.patch(`/tasks/${id}`, patch).then((r) => r.data.task)
export const deleteTask = (id) => api.delete(`/tasks/${id}`).then(data)

// --- comments ---
export const getComments = (taskId) => api.get(`/tasks/${taskId}/comments`).then((r) => r.data.comments)
export const addComment = (taskId, content) =>
  api.post(`/tasks/${taskId}/comments`, { content }).then((r) => r.data.comment)

// --- chat ---
export const getChannels = (workspaceId) =>
  api.get('/channels', { params: { workspaceId } }).then((r) => r.data.channels)
export const createChannel = (workspaceId, name, purpose) =>
  api.post('/channels', { workspaceId, name, purpose }).then((r) => r.data.channel)
export const getMessages = (channelId, after) =>
  api.get(`/channels/${channelId}/messages`, { params: after ? { after } : {} }).then((r) => r.data.messages)
export const sendMessage = (channelId, content, taskId) =>
  api.post(`/channels/${channelId}/messages`, { content, taskId }).then((r) => r.data.message)

// --- notifications ---
export const getNotifications = (filter = 'all') =>
  api.get('/notifications', { params: { filter } }).then(data)
export const getUnreadCount = () => api.get('/notifications/count').then((r) => r.data.unread)
export const markRead = (id) => api.patch(`/notifications/${id}/read`).then(data)
export const markAllRead = () => api.post('/notifications/read-all').then(data)

// --- analytics (admin only) ---
export const getAnalytics = (workspaceId) => api.get(`/analytics/${workspaceId}`).then(data)

// --- settings ---
export const getPrefs = () => api.get('/settings/prefs').then(data)
export const updatePrefs = (patch) => api.patch('/settings/prefs', patch).then((r) => r.data.prefs)
export const sendTestEmail = () => api.post('/settings/test-email').then(data)

export default api
