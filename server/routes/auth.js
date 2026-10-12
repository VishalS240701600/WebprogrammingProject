// Auth routes: register, login, logout, current user.
const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const v = require('../utils/validate');

const router = express.Router();
const SALT_ROUNDS = 10;

// Slow down password guessing: 20 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

// A fake hash so login takes the same time whether or not the email exists
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', SALT_ROUNDS);

// Store the user id in the session (regenerate the id first to prevent session fixation)
function startSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      resolve();
    });
  });
}

// The fields we are happy to send back about the logged-in user
function publicUser(id) {
  return db
    .prepare('SELECT id, name, email, phone, organization, is_admin FROM users WHERE id = ?')
    .get(id);
}

router.post('/register', authLimiter, async (req, res) => {
  const email = v.email(req.body.email);
  const password = v.password(req.body.password);
  const name = v.text(req.body.name, 'Name', { max: 80 });
  const phone = v.phone(req.body.phone);
  const organization = v.text(req.body.organization, 'Organization', { optional: true, max: 120 });

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw new v.HttpError(409, 'An account with that email already exists.');
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const info = db
    .prepare('INSERT INTO users (email, password_hash, name, phone, organization) VALUES (?, ?, ?, ?, ?)')
    .run(email, hash, name, phone, organization);

  await startSession(req, info.lastInsertRowid);
  res.status(201).json({ user: publicUser(info.lastInsertRowid) });
});

router.post('/login', authLimiter, async (req, res) => {
  const email = v.email(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
  const ok = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) throw new v.HttpError(401, 'Incorrect email or password.');

  await startSession(req, row.id);
  res.json({ user: publicUser(row.id) });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// Used by the front-end on every page to know whether someone is logged in
router.get('/me', (req, res) => {
  const id = req.session && req.session.userId;
  res.json({ user: id ? publicUser(id) || null : null });
});

module.exports = router;
