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

// --- auth ---
export const authSignup = (name, email, password) =>
  api.post('/auth/signup', { name, email, password }).then((r) => r.data)
export const authLogin = (email, password) =>
  api.post('/auth/login', { email, password }).then((r) => r.data)
export const authMe = () => api.get('/auth/me').then((r) => r.data.user)

// --- workspaces ---
export const getWorkspaces = () => api.get('/workspaces').then((r) => r.data.workspaces)
export const getWorkspace = (id) => api.get(`/workspaces/${id}`).then((r) => r.data.workspace)
export const createWorkspace = (name) =>
  api.post('/workspaces', { name }).then((r) => r.data.workspace)
export const addMember = (workspaceId, email) =>
  api.post(`/workspaces/${workspaceId}/members`, { email }).then((r) => r.data)

// --- tasks ---
export const getTasks = (workspaceId) =>
  api.get('/tasks', { params: { workspaceId } }).then((r) => r.data.tasks)
export const getMyTasks = () => api.get('/tasks/assigned/me').then((r) => r.data.tasks)
export const createTask = (data) => api.post('/tasks', data).then((r) => r.data.task)
export const updateTask = (id, patch) => api.patch(`/tasks/${id}`, patch).then((r) => r.data.task)
export const deleteTask = (id) => api.delete(`/tasks/${id}`).then((r) => r.data)

export default api
