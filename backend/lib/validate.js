/**
 * Input validation + normalisation.
 *
 * The normalisation half is what stops duplicate accounts: emails are lower-cased
 * and trimmed before they ever reach the database, so "Foo@Bar.com  " and
 * "foo@bar.com" are the same unique key.
 */

// Deliberately pragmatic, not RFC-complete: one @, something either side,
// a dot in the domain, no spaces.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

const normalizeEmail = (email) => String(email || '').trim().toLowerCase()
const normalizeName = (name) => String(name || '').trim().replace(/\s+/g, ' ')

function validateEmail(raw) {
  const email = normalizeEmail(raw)
  if (!email) return { error: 'Email is required' }
  if (email.length > 254) return { error: 'That email is too long' }
  if (!EMAIL_RE.test(email)) return { error: 'That does not look like a valid email address' }
  return { value: email }
}

function validatePassword(password) {
  if (typeof password !== 'string' || !password) return { error: 'Password is required' }
  if (password.length < 8) return { error: 'Password must be at least 8 characters' }
  if (password.length > 200) return { error: 'Password is too long' }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { error: 'Password must contain at least one letter and one number' }
  }
  return { value: password }
}

function validateName(raw) {
  const name = normalizeName(raw)
  if (!name) return { error: 'Name is required' }
  if (name.length < 2) return { error: 'Name is too short' }
  if (name.length > 80) return { error: 'Name is too long' }
  return { value: name }
}

/** Trim a free-text field and enforce a max length. */
function text(raw, { max = 500, field = 'value', required = false } = {}) {
  const v = String(raw ?? '').trim()
  if (!v) return required ? { error: `${field} is required` } : { value: null }
  if (v.length > max) return { error: `${field} must be under ${max} characters` }
  return { value: v }
}

module.exports = { normalizeEmail, normalizeName, validateEmail, validatePassword, validateName, text }
