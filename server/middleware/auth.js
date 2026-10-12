// Authentication / authorization middleware.
const db = require('../db');
const { HttpError } = require('../utils/validate');

// Must be logged in. Loads the user into req.user.
function requireLogin(req, res, next) {
  const id = req.session && req.session.userId;
  const user = id && db.prepare('SELECT id, name, email, is_admin FROM users WHERE id = ?').get(id);
  if (!user) return next(new HttpError(401, 'Please log in to continue.'));
  req.user = user;
  next();
}

// Must be an admin (use after requireLogin).
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) return next(new HttpError(403, 'Admins only.'));
  next();
}

module.exports = { requireLogin, requireAdmin };
