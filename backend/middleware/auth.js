const jwt = require('jsonwebtoken');

// Route protection. Reads the "Authorization: Bearer <token>" header,
// verifies the JWT was signed by us, and hangs the user's id on
// req.userId so the route handler knows who is calling.
// Any protected route just does:  router.get('/thing', auth, handler)
module.exports = function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
