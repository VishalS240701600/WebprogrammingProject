// RideBuddy - Express server entry point.
const express = require('express');
const session = require('express-session');
const path = require('path');

require('./db'); // opens the database and creates tables
const { requireLogin, requireAdmin } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errors');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// When the front-end is on GitHub Pages (a different domain), set FRONTEND_ORIGIN to its origin,
// e.g. https://yourname.github.io  (no path, no trailing slash). Leave unset for local dev.
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN;
const crossSite = Boolean(FRONTEND_ORIGIN);
if (isProd) app.set('trust proxy', 1); // hosts like Render sit behind a proxy; needed for secure cookies

if (isProd && !process.env.SESSION_SECRET) {
  console.error('Set SESSION_SECRET before running in production.');
  process.exit(1);
}

// ---- CORS (only needed when the front-end is hosted on another origin) ----
// Credentials are allowed so the session cookie works, so the origin must be one exact value, never '*'.
if (crossSite) {
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.append('Vary', 'Origin');
    if (req.method === 'OPTIONS') return res.sendStatus(204); // answer the browser's preflight check
    next();
  });
}

// ---- Basic middleware ----
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Sessions: a signed cookie holds the session id; data lives in server memory.
// (Fine for a class project - sessions reset when the server restarts.)
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: crossSite ? 'none' : 'lax', secure: isProd || crossSite, maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

// ---- API routes ----
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/rides', require('./routes/rides'));
app.use('/api/geocode', require('./routes/geocode'));
app.use('/api/admin', requireLogin, requireAdmin, require('./routes/admin'));
app.use('/api', require('./routes/requests')); // /rides/:id/requests, /requests/...
app.use('/api', require('./routes/ratings')); // /ratings, /rides/:id/ratable
app.use('/api', notFound); // unknown API path -> JSON 404

// ---- Static front-end ----
// The same docs/ folder is what GitHub Pages publishes; Express also serves it for local development.
app.use(express.static(path.join(__dirname, '..', 'docs')));

app.use(errorHandler);

// 0.0.0.0 = accept connections from outside the container (Render needs this)
app.listen(PORT, '0.0.0.0', () => console.log(`RideBuddy running on port ${PORT}`));
