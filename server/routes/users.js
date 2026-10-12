// User profile routes.
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const v = require('../utils/validate');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// Update my own profile (name, phone, organization, optional password change)
router.put('/me', requireLogin, async (req, res) => {
  const name = v.text(req.body.name, 'Name', { max: 80 });
  const phone = v.phone(req.body.phone);
  const organization = v.text(req.body.organization, 'Organization', { optional: true, max: 120 });

  db.prepare('UPDATE users SET name = ?, phone = ?, organization = ? WHERE id = ?')
    .run(name, phone, organization, req.user.id);

  // Password change is optional: only when a new password is supplied
  if (req.body.new_password) {
    const newPassword = v.password(req.body.new_password);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const ok = await bcrypt.compare(String(req.body.current_password || ''), row.password_hash);
    if (!ok) throw new v.HttpError(400, 'Current password is incorrect.');
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  }

  const user = db
    .prepare('SELECT id, name, email, phone, organization, is_admin FROM users WHERE id = ?')
    .get(req.user.id);
  res.json({ user });
});

// Public profile: name, organization, average rating. Phone only for yourself / admins.
router.get('/:id', (req, res) => {
  const id = v.int(req.params.id, 'User id', { min: 1 });
  const user = db
    .prepare(
      `SELECT u.id, u.name, u.organization, u.created_at, u.phone,
              (SELECT ROUND(AVG(score), 1) FROM ratings WHERE ratee_id = u.id) AS avg_rating,
              (SELECT COUNT(*) FROM ratings WHERE ratee_id = u.id) AS rating_count,
              (SELECT COUNT(*) FROM rides WHERE driver_id = u.id) AS rides_posted
         FROM users u WHERE u.id = ?`
    )
    .get(id);
  if (!user) throw new v.HttpError(404, 'User not found.');

  const viewerId = req.session && req.session.userId;
  const viewer = viewerId && db.prepare('SELECT is_admin FROM users WHERE id = ?').get(viewerId);
  if (!(viewerId === id || (viewer && viewer.is_admin))) delete user.phone;

  res.json({ user });
});

// Ratings received by a user (newest first)
router.get('/:id/ratings', (req, res) => {
  const id = v.int(req.params.id, 'User id', { min: 1 });
  const ratings = db
    .prepare(
      `SELECT g.id, g.score, g.comment, g.created_at, g.ride_id,
              u.id AS rater_id, u.name AS rater_name
         FROM ratings g JOIN users u ON u.id = g.rater_id
        WHERE g.ratee_id = ?
        ORDER BY g.created_at DESC, g.id DESC
        LIMIT 50`
    )
    .all(id);
  res.json({ ratings });
});

module.exports = router;
