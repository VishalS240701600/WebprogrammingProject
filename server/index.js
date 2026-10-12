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

if (isProd && !process.env.SESSION_SECRET) {
  console.error('Set SESSION_SECRET before running in production.');
  process.exit(1);
}

// ---- Basic middleware ----
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

// Sessions: a signed cookie holds the session id; data lives in server memory.
// (Fine for a class project - sessions reset when the server restarts.)
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 7 * 24 * 60 * 60 * 1000 },
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
app.use('/vendor/leaflet', express.static(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist')));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(errorHandler);

app.listen(PORT, () => console.log(`RideBuddy running at http://localhost:${PORT}`));
