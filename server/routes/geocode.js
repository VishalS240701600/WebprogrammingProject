// Geocoding proxy for Nominatim (OpenStreetMap's free search service).
//
// Nominatim's usage policy requires: a real User-Agent, max 1 request/second,
// and no hammering. So the browser talks to OUR server, and our server:
//   1. sets the User-Agent,
//   2. spaces requests at least 1.1 s apart (a simple queue),
//   3. caches answers in memory, and
//   4. limits each visitor to 30 lookups per minute.
// (The browser also debounces typing - see public/js/map.js.)
const express = require('express');
const rateLimit = require('express-rate-limit');
const v = require('../utils/validate');

const router = express.Router();

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'RideBuddy-ClassProject/1.0 (student carpool demo)';
const COUNTRY = process.env.NOMINATIM_COUNTRY || 'in'; // bias results to India; set '' to disable
const MIN_GAP_MS = 1100;
const CACHE_MS = 60 * 60 * 1000;

const cache = new Map(); // url -> { time, data }
let queue = Promise.resolve(); // each request waits for the previous one
let lastCall = 0;

function cachedFetch(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.time < CACHE_MS) return Promise.resolve(hit.data);

  const job = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();

    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);
    const data = await res.json();
    if (cache.size > 500) cache.clear(); // keep memory bounded
    cache.set(url, { time: Date.now(), data });
    return data;
  });
  queue = job.catch(() => {}); // a failure must not block the queue
  return job;
}

router.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many address lookups. Please wait a moment.' },
  })
);

const wrapFailure = (err) => {
  if (err instanceof v.HttpError) throw err;
  console.error('Geocoding failed:', err.message);
  throw new v.HttpError(502, 'The address search service is unavailable right now. Try clicking the map instead.');
};

// GET /api/geocode?q=Anna University  ->  { results: [{ label, lat, lng }] }
router.get('/', async (req, res) => {
  const q = v.text(req.query.q, 'Search text', { min: 3, max: 150 });
  const params = new URLSearchParams({ q, format: 'jsonv2', limit: '5', addressdetails: '0' });
  if (COUNTRY) params.set('countrycodes', COUNTRY);
  try {
    const data = await cachedFetch(`${NOMINATIM}/search?${params}`);
    res.json({
      results: data.map((d) => ({ label: d.display_name, lat: Number(d.lat), lng: Number(d.lon) })),
    });
  } catch (err) {
    wrapFailure(err);
  }
});

// GET /api/geocode/reverse?lat=..&lng=..  ->  { label }  (used when clicking the map)
router.get('/reverse', async (req, res) => {
  const lat = v.lat(req.query.lat, 'Latitude');
  const lng = v.lng(req.query.lng, 'Longitude');
  const params = new URLSearchParams({ lat: lat.toFixed(5), lon: lng.toFixed(5), format: 'jsonv2', zoom: '17' });
  try {
    const data = await cachedFetch(`${NOMINATIM}/reverse?${params}`);
    res.json({ label: data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}` });
  } catch (err) {
    wrapFailure(err);
  }
});

module.exports = router;
