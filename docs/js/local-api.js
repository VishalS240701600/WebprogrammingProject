// A tiny "backend" that runs inside the browser, so the site works on GitHub Pages with no server.
// It answers the same URLs as the Express API in server/ (api.js calls localApi() instead of fetch()),
// and keeps all data in localStorage. That means:
//   - every visitor gets their own private copy of the data (nothing is shared between browsers)
//   - clearing site data resets everything back to the demo data
// The rules (validation, seat counting, privacy, matching) are copied from the server code.

// Wrapped in a function so its helper names stay private (scripts on a page share one global scope).
// Only localApi() and resetDemoData() are exposed.
(function () {
// ---------- Errors ----------
class LocalHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new LocalHttpError(400, msg);

// ---------- Validation (same rules as server/utils/validate.js) ----------
const V = {
  text(value, label, { min = 1, max = 200, optional = false } = {}) {
    if (value === undefined || value === null || String(value).trim() === '') {
      if (optional) return null;
      throw bad(`${label} is required.`);
    }
    const s = String(value).trim();
    if (s.length < min) throw bad(`${label} must be at least ${min} characters.`);
    if (s.length > max) throw bad(`${label} must be at most ${max} characters.`);
    return s;
  },
  email(value) {
    const s = V.text(value, 'Email', { max: 120 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('Please enter a valid email address.');
    return s;
  },
  password(value) {
    if (typeof value !== 'string' || value.length < 8) throw bad('Password must be at least 8 characters.');
    if (value.length > 72) throw bad('Password must be at most 72 characters.');
    return value;
  },
  phone(value) {
    const s = V.text(value, 'Phone', { optional: true, max: 20 });
    if (s && !/^[0-9+()\-\s]{7,20}$/.test(s)) throw bad('Please enter a valid phone number.');
    return s;
  },
  int(value, label, { min = -Infinity, max = Infinity } = {}) {
    const n = Number(value);
    if (value === '' || value === null || value === undefined || !Number.isInteger(n)) throw bad(`${label} must be a whole number.`);
    if (n < min || n > max) throw bad(`${label} must be between ${min} and ${max}.`);
    return n;
  },
  number(value, label, { min = -Infinity, max = Infinity } = {}) {
    const n = Number(value);
    if (value === '' || value === null || value === undefined || !Number.isFinite(n)) throw bad(`${label} must be a number.`);
    if (n < min || n > max) throw bad(`${label} must be between ${min} and ${max}.`);
    return n;
  },
  lat: (value, label) => V.number(value, label, { min: -90, max: 90 }),
  lng: (value, label) => V.number(value, label, { min: -180, max: 180 }),
  date(value, label = 'Date') {
    const s = String(value || '');
    const d = new Date(s + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s)
      throw bad(`${label} must be a valid date (YYYY-MM-DD).`);
    return s;
  },
  time(value, label = 'Time') {
    const s = String(value || '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw bad(`${label} must be a valid time (HH:MM).`);
    return s;
  },
  days(value) {
    const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return null;
    const list = Array.isArray(value) ? value : String(value).split(',');
    const clean = [...new Set(list.map((d) => String(d).trim()))];
    if (clean.some((d) => !DAYS.includes(d))) throw bad('Recurring days must be Mon, Tue, Wed, Thu, Fri, Sat or Sun.');
    return DAYS.filter((d) => clean.includes(d)).join(',');
  },
};

// ---------- Dates ----------
const pad2 = (n) => String(n).padStart(2, '0');
function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
const todayStr = () => dateOffset(0);
const weekdayOf = (dateStr) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(dateStr + 'T00:00:00Z').getUTCDay()];
const nowStamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19); // like SQLite's datetime('now')

// ---------- Matching (same algorithm as server/utils/matching.js) ----------
const MAX_DISTANCE_KM = 10;
const WEIGHTS = { pickup: 0.4, drop: 0.4, time: 0.2 };
const toRad = (deg) => (deg * Math.PI) / 180;
function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}
const timeToMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const falloff = (value, limit) => Math.max(0, 1 - value / limit);

function scoreRide(ride, query) {
  const parts = []; // [weight, subScore]
  const result = { pickupKm: null, dropKm: null, timeDiffMins: null };
  if (query.fromLat != null) {
    result.pickupKm = haversineKm(query.fromLat, query.fromLng, ride.origin_lat, ride.origin_lng);
    parts.push([WEIGHTS.pickup, falloff(result.pickupKm, MAX_DISTANCE_KM)]);
  }
  if (query.toLat != null) {
    result.dropKm = haversineKm(query.toLat, query.toLng, ride.dest_lat, ride.dest_lng);
    parts.push([WEIGHTS.drop, falloff(result.dropKm, MAX_DISTANCE_KM)]);
  }
  if (query.time) {
    result.timeDiffMins = Math.abs(timeToMinutes(ride.depart_time) - timeToMinutes(query.time));
    parts.push([WEIGHTS.time, falloff(result.timeDiffMins, query.windowMins)]);
  }
  const totalWeight = parts.reduce((sum, [w]) => sum + w, 0);
  const score = totalWeight ? (100 * parts.reduce((sum, [w, s]) => sum + w * s, 0)) / totalWeight : 50;
  return { score: Math.round(score), ...result };
}

function rankRides(rides, query) {
  return rides
    .map((ride) => ({ ...ride, match: scoreRide(ride, query) }))
    .filter((r) => {
      const m = r.match;
      if (m.pickupKm != null && m.pickupKm > MAX_DISTANCE_KM) return false;
      if (m.dropKm != null && m.dropKm > MAX_DISTANCE_KM) return false;
      if (m.timeDiffMins != null && m.timeDiffMins > query.windowMins) return false;
      return true;
    })
    .sort((a, b) => b.match.score - a.match.score);
}

// ---------- Password hashing (Web Crypto, PBKDF2) ----------
// Note: this protects against casual snooping only. The data lives in the visitor's own browser.
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hashPassword(password, saltHex) {
  const salt = saltHex || toHex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 50000 },
    key,
    256
  );
  return `${salt}$${toHex(bits)}`;
}
async function checkPassword(password, stored) {
  const [salt] = stored.split('$');
  return (await hashPassword(password, salt)) === stored;
}

// ---------- The "database": plain arrays saved in localStorage ----------
const DB_KEY = 'ridebuddy_db_v1';
const SESSION_KEY = 'ridebuddy_session_v1';
let db = null; // { users, rides, requests, ratings, nextId: {...} }

function save() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (e) {
    // storage full or blocked: data still works until the page is closed
    console.warn('Could not save to localStorage:', e.message);
  }
}
const newId = (table) => db.nextId[table]++;

function getSessionUserId() {
  try {
    return Number(localStorage.getItem(SESSION_KEY)) || null;
  } catch (e) {
    return memorySession;
  }
}
let memorySession = null;
function setSessionUserId(id) {
  memorySession = id;
  try {
    if (id) localStorage.setItem(SESSION_KEY, String(id));
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) { /* private mode: session lasts until the page closes */ }
}

// Demo data, same as db/seed.js. Dates are relative to the day it is first created.
async function createDemoData() {
  db = { users: [], rides: [], requests: [], ratings: [], nextId: { users: 1, rides: 1, requests: 1, ratings: 1 } };

  const PLACES = {
    tambaram: ['Tambaram Railway Station, Chennai', 12.9249, 80.1],
    annaUniv: ['Anna University, Guindy, Chennai', 13.0108, 80.2357],
    iitm: ['IIT Madras, Chennai', 12.9916, 80.2336],
    velachery: ['Velachery, Chennai', 12.9815, 80.218],
    tidel: ['Tidel Park, Taramani, Chennai', 12.9876, 80.2476],
    annaNagar: ['Anna Nagar Tower, Chennai', 13.085, 80.2101],
    porur: ['Porur Junction, Chennai', 13.0382, 80.1565],
    guindy: ['Guindy Industrial Estate, Chennai', 13.0067, 80.2206],
    omr: ['Sholinganallur, OMR, Chennai', 12.901, 80.2279],
    adyar: ['Adyar Signal, Chennai', 13.0067, 80.257],
    tnagar: ['T. Nagar Bus Terminus, Chennai', 13.0418, 80.2341],
    central: ['Chennai Central Railway Station', 13.0827, 80.2707],
    thandalam: ['Rajalakshmi Engineering College, Thandalam', 12.991, 80.057],
    perungudi: ['Perungudi, Chennai', 12.965, 80.2461],
  };

  const user = {};
  const sharedHash = await hashPassword('password123');
  for (const [key, email, name, phone, org] of [
    ['arjun', 'arjun@ridebuddy.test', 'Arjun Kumar', '9840011111', 'Anna University'],
    ['priya', 'priya@ridebuddy.test', 'Priya Sharma', '9840022222', 'Tidel Park IT Campus'],
    ['karthik', 'karthik@ridebuddy.test', 'Karthik Raj', '9840033333', 'IIT Madras'],
    ['meena', 'meena@ridebuddy.test', 'Meena Iyer', '9840044444', 'Anna University'],
    ['rahul', 'rahul@ridebuddy.test', 'Rahul Verma', '9840055555', 'Tidel Park IT Campus'],
    ['divya', 'divya@ridebuddy.test', 'Divya Lakshmi', '9840066666', 'IIT Madras'],
    ['sanjay', 'sanjay@ridebuddy.test', 'Sanjay Patel', '9840077777', 'Rajalakshmi Engineering College'],
  ]) {
    user[key] = newId('users');
    db.users.push({ id: user[key], email, password_hash: sharedHash, name, phone, organization: org, is_admin: 0, created_at: nowStamp() });
  }
  user.admin = newId('users');
  db.users.push({
    id: user.admin, email: 'admin@ridebuddy.test', password_hash: await hashPassword('admin1234'),
    name: 'RideBuddy Admin', phone: '9840000000', organization: 'RideBuddy', is_admin: 1, created_at: nowStamp(),
  });

  function addRide(driver, from, to, offset, time, seats, cost, { days = null, notes = null } = {}) {
    const [oLabel, oLat, oLng] = PLACES[from];
    const [dLabel, dLat, dLng] = PLACES[to];
    const id = newId('rides');
    db.rides.push({
      id, driver_id: user[driver], origin_label: oLabel, origin_lat: oLat, origin_lng: oLng,
      dest_label: dLabel, dest_lat: dLat, dest_lng: dLng, ride_date: dateOffset(offset), depart_time: time,
      recurring_days: days, total_seats: seats, seats_available: seats, cost_per_seat: cost, notes, created_at: nowStamp(),
    });
    return id;
  }
  const WEEKDAYS = 'Mon,Tue,Wed,Thu,Fri';
  const ride = {
    tambToAnna: addRide('arjun', 'tambaram', 'annaUniv', 1, '08:00', 4, 40, { days: WEEKDAYS, notes: 'Honda City, AC. Pickup at the station exit.' }),
    velToTidel: addRide('priya', 'velachery', 'tidel', 1, '08:30', 3, 30, { notes: 'Leaving sharp at 8:30. Music on, chat optional.' }),
    annaNToIitm: addRide('karthik', 'annaNagar', 'iitm', 1, '07:45', 3, 50, { days: WEEKDAYS }),
    porurToGuindy: addRide('meena', 'porur', 'guindy', 2, '09:00', 2, 35, { notes: 'Small hatchback, 2 seats only.' }),
    omrToAnna: addRide('rahul', 'omr', 'annaUniv', 2, '08:15', 2, 60, { days: WEEKDAYS, notes: 'Via Taramani and Velachery.' }),
    tambToTidel: addRide('divya', 'tambaram', 'tidel', 1, '08:10', 3, 45),
    annaToTamb: addRide('arjun', 'annaUniv', 'tambaram', 1, '17:30', 4, 40, { days: WEEKDAYS, notes: 'Evening return trip.' }),
    thandToGuindy: addRide('sanjay', 'thandalam', 'guindy', 3, '07:30', 3, 55, { notes: 'Leaving from the college main gate.' }),
    tnagarToCent: addRide('priya', 'tnagar', 'central', 3, '18:00', 2, 25),
    pastA: addRide('arjun', 'tambaram', 'annaUniv', -3, '08:00', 4, 40, { notes: 'Past ride for the rating demo.' }),
    pastB: addRide('karthik', 'annaNagar', 'iitm', -5, '07:45', 3, 50),
  };

  function addRequest(rideId, rider, seats, status, message = null) {
    db.requests.push({ id: newId('requests'), ride_id: rideId, rider_id: user[rider], seats_requested: seats, status, message, created_at: nowStamp() });
    if (status === 'accepted') db.rides.find((r) => r.id === rideId).seats_available -= seats;
  }
  addRequest(ride.tambToAnna, 'divya', 1, 'accepted', 'Same route every morning!');
  addRequest(ride.tambToAnna, 'rahul', 1, 'pending', 'Can you drop me near the main gate?');
  addRequest(ride.velToTidel, 'karthik', 1, 'pending');
  addRequest(ride.annaNToIitm, 'meena', 1, 'declined');
  addRequest(ride.annaNToIitm, 'divya', 2, 'cancelled', 'Plans changed, sorry.');
  addRequest(ride.omrToAnna, 'priya', 1, 'accepted');
  addRequest(ride.thandToGuindy, 'arjun', 1, 'pending');
  addRequest(ride.pastA, 'priya', 1, 'accepted');
  addRequest(ride.pastA, 'meena', 1, 'accepted');
  addRequest(ride.pastB, 'rahul', 1, 'accepted');

  const addRating = (rideId, rater, ratee, score, comment) =>
    db.ratings.push({ id: newId('ratings'), ride_id: rideId, rater_id: user[rater], ratee_id: user[ratee], score, comment, created_at: nowStamp() });
  addRating(ride.pastA, 'priya', 'arjun', 5, 'Very punctual and a smooth driver.');
  addRating(ride.pastA, 'arjun', 'priya', 4, 'Friendly co-passenger.');
  addRating(ride.pastA, 'meena', 'arjun', 5, 'Comfortable ride, would go again!');
  addRating(ride.pastB, 'rahul', 'karthik', 4, 'Good driver, a little late.');

  save();
}

// Load from localStorage, or create the demo data the first time.
let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      try {
        db = JSON.parse(localStorage.getItem(DB_KEY));
      } catch (e) {
        db = null;
      }
      if (!db || !db.users) await createDemoData();
    })();
  }
  return ready;
}

// Wipe everything back to the demo data (handy from the browser console: resetDemoData())
async function resetDemoData() {
  await init();
  setSessionUserId(null);
  await createDemoData();
}

// ---------- Helpers shared by the routes ----------
const byId = (table, id) => db[table].find((row) => row.id === id);
const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, phone: u.phone, organization: u.organization, is_admin: u.is_admin };

function ratingStats(userId) {
  const scores = db.ratings.filter((g) => g.ratee_id === userId).map((g) => g.score);
  return {
    avg: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    count: scores.length,
  };
}

// A ride plus its driver's name and rating (like RIDE_SELECT in server/routes/rides.js)
function rideWithDriver(r) {
  const driver = byId('users', r.driver_id);
  const stats = ratingStats(r.driver_id);
  return { ...r, driver_name: driver.name, driver_org: driver.organization, driver_rating: stats.avg, driver_rating_count: stats.count };
}

const isExpired = (ride) => !ride.recurring_days && ride.ride_date < todayStr();

function requireLogin() {
  const user = byId('users', getSessionUserId());
  if (!user) throw new LocalHttpError(401, 'Please log in to continue.');
  return user;
}
function requireAdmin() {
  const user = requireLogin();
  if (!user.is_admin) throw new LocalHttpError(403, 'Admins only.');
  return user;
}

function removeRide(id) {
  db.rides = db.rides.filter((r) => r.id !== id);
  db.requests = db.requests.filter((q) => q.ride_id !== id); // same as ON DELETE CASCADE
  db.ratings = db.ratings.filter((g) => g.ride_id !== id);
}

// ---------- Address search (Nominatim, called straight from the browser) ----------
// Nominatim allows browser calls but asks for at most 1 request/second, so we queue and cache.
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const COUNTRY = 'in'; // bias results to India; set '' to disable
const geoCache = new Map();
let geoQueue = Promise.resolve();
let lastGeoCall = 0;

function geoFetch(url) {
  if (geoCache.has(url)) return Promise.resolve(geoCache.get(url));
  const job = geoQueue.then(async () => {
    const wait = lastGeoCall + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastGeoCall = Date.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);
    const data = await res.json();
    geoCache.set(url, data);
    return data;
  });
  geoQueue = job.catch(() => {});
  return job.catch(() => {
    throw new LocalHttpError(502, 'The address search service is unavailable right now. Try clicking the map instead.');
  });
}

// ---------- Routes ----------
// Each entry: [method, path pattern, handler({ params, query, body })] - first match wins,
// so '/rides/search' and '/rides/mine' come before '/rides/:id'.
const routes = [];
const route = (method, pattern, handler) => routes.push([method, new RegExp('^' + pattern.replace(/:\w+/g, '([^/]+)') + '$'), handler]);

// ----- auth -----
route('POST', '/auth/register', async ({ body }) => {
  const email = V.email(body.email);
  const password = V.password(body.password);
  const name = V.text(body.name, 'Name', { max: 80 });
  const phone = V.phone(body.phone);
  const organization = V.text(body.organization, 'Organization', { optional: true, max: 120 });
  if (db.users.some((u) => u.email === email)) throw new LocalHttpError(409, 'An account with that email already exists.');

  const user = { id: newId('users'), email, password_hash: await hashPassword(password), name, phone, organization, is_admin: 0, created_at: nowStamp() };
  db.users.push(user);
  save();
  setSessionUserId(user.id);
  return { user: publicUser(user) };
});

route('POST', '/auth/login', async ({ body }) => {
  const email = V.email(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const user = db.users.find((u) => u.email === email);
  if (!user || !(await checkPassword(password, user.password_hash))) throw new LocalHttpError(401, 'Incorrect email or password.');
  setSessionUserId(user.id);
  return { user: publicUser(user) };
});

route('POST', '/auth/logout', () => {
  setSessionUserId(null);
  return { ok: true };
});

route('GET', '/auth/me', () => ({ user: publicUser(byId('users', getSessionUserId())) || null }));

// ----- users -----
route('PUT', '/users/me', async ({ body }) => {
  const me = requireLogin();
  const name = V.text(body.name, 'Name', { max: 80 });
  const phone = V.phone(body.phone);
  const organization = V.text(body.organization, 'Organization', { optional: true, max: 120 });

  let newHash = null;
  if (body.new_password) {
    const newPassword = V.password(body.new_password);
    if (!(await checkPassword(String(body.current_password || ''), me.password_hash))) throw bad('Current password is incorrect.');
    newHash = await hashPassword(newPassword);
  }
  Object.assign(me, { name, phone, organization });
  if (newHash) me.password_hash = newHash;
  save();
  return { user: publicUser(me) };
});

route('GET', '/users/:id', ({ params }) => {
  const id = V.int(params[0], 'User id', { min: 1 });
  const u = byId('users', id);
  if (!u) throw new LocalHttpError(404, 'User not found.');
  const stats = ratingStats(id);
  const user = {
    id: u.id, name: u.name, organization: u.organization, created_at: u.created_at, phone: u.phone,
    avg_rating: stats.avg, rating_count: stats.count, rides_posted: db.rides.filter((r) => r.driver_id === id).length,
  };
  const viewer = byId('users', getSessionUserId());
  if (!(viewer && (viewer.id === id || viewer.is_admin))) delete user.phone; // phone only for yourself / admins
  return { user };
});

route('GET', '/users/:id/ratings', ({ params }) => {
  const id = V.int(params[0], 'User id', { min: 1 });
  const ratings = db.ratings
    .filter((g) => g.ratee_id === id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id))
    .slice(0, 50)
    .map((g) => ({
      id: g.id, score: g.score, comment: g.comment, created_at: g.created_at, ride_id: g.ride_id,
      rater_id: g.rater_id, rater_name: byId('users', g.rater_id).name,
    }));
  return { ratings };
});

// ----- rides -----
route('POST', '/rides', ({ body: b }) => {
  const me = requireLogin();
  const ride = {
    origin_label: V.text(b.origin_label, 'Origin', { max: 200 }),
    origin_lat: V.lat(b.origin_lat, 'Origin latitude'),
    origin_lng: V.lng(b.origin_lng, 'Origin longitude'),
    dest_label: V.text(b.dest_label, 'Destination', { max: 200 }),
    dest_lat: V.lat(b.dest_lat, 'Destination latitude'),
    dest_lng: V.lng(b.dest_lng, 'Destination longitude'),
    ride_date: V.date(b.ride_date, 'Date'),
    depart_time: V.time(b.depart_time, 'Departure time'),
    recurring_days: V.days(b.recurring_days),
    total_seats: V.int(b.total_seats, 'Seats', { min: 1, max: 10 }),
    cost_per_seat: V.number(b.cost_per_seat ?? 0, 'Cost per seat', { min: 0, max: 100000 }),
    notes: V.text(b.notes, 'Notes', { optional: true, max: 500 }),
  };
  if (ride.ride_date < todayStr()) throw bad('The ride date cannot be in the past.');

  const id = newId('rides');
  db.rides.push({ id, driver_id: me.id, ...ride, seats_available: ride.total_seats, created_at: nowStamp() });
  save();
  return { id };
});

route('GET', '/rides/search', ({ query: q }) => {
  const has = (k) => q.get(k) !== null && q.get(k) !== '';
  const query = { windowMins: has('window') ? V.int(q.get('window'), 'Time window', { min: 5, max: 720 }) : 60 };

  if (has('fromLat') || has('fromLng')) {
    query.fromLat = V.lat(q.get('fromLat'), 'Pickup latitude');
    query.fromLng = V.lng(q.get('fromLng'), 'Pickup longitude');
  }
  if (has('toLat') || has('toLng')) {
    query.toLat = V.lat(q.get('toLat'), 'Drop-off latitude');
    query.toLng = V.lng(q.get('toLng'), 'Drop-off longitude');
  }
  if (has('time')) query.time = V.time(q.get('time'), 'Time');

  // Step 1: narrow down by date and available seats
  const today = todayStr();
  let candidates = db.rides.filter((r) => r.seats_available > 0);
  if (has('date')) {
    const date = V.date(q.get('date'), 'Date');
    if (date < today) throw bad('The search date cannot be in the past.');
    const weekday = weekdayOf(date);
    // exact date, OR a recurring ride that already started and runs on that weekday
    candidates = candidates.filter((r) => r.ride_date === date || (r.recurring_days && r.ride_date <= date && r.recurring_days.split(',').includes(weekday)));
  } else {
    candidates = candidates.filter((r) => r.ride_date >= today || r.recurring_days);
  }
  // Step 2: score, filter and sort with the matching algorithm
  const results = rankRides(candidates.slice(0, 500).map(rideWithDriver), query);
  return { results: results.slice(0, 50), count: results.length };
});

route('GET', '/rides/mine', () => {
  const me = requireLogin();
  const rides = db.rides
    .filter((r) => r.driver_id === me.id)
    .sort((a, b) => (a.ride_date + a.depart_time < b.ride_date + b.depart_time ? 1 : -1))
    .map((r) => ({
      ...rideWithDriver(r),
      is_past: r.ride_date < todayStr(),
      requests: db.requests
        .filter((q) => q.ride_id === r.id)
        .sort((a, b) => b.id - a.id)
        .map((q) => {
          const rider = byId('users', q.rider_id);
          return { ...q, rider_name: rider.name, rider_phone: rider.phone, rider_org: rider.organization };
        }),
    }));
  return { rides };
});

route('GET', '/rides/:id', ({ params }) => {
  const id = V.int(params[0], 'Ride id', { min: 1 });
  const found = byId('rides', id);
  if (!found) throw new LocalHttpError(404, 'Ride not found.');
  const ride = rideWithDriver(found);

  const userId = getSessionUserId();
  ride.is_mine = userId === ride.driver_id;
  ride.is_past = ride.ride_date < todayStr();
  ride.is_expired = isExpired(ride);
  const mine = userId ? db.requests.filter((q) => q.ride_id === id && q.rider_id === userId).sort((a, b) => b.id - a.id)[0] : null;
  ride.my_request = mine ? { id: mine.id, status: mine.status, seats_requested: mine.seats_requested } : null;

  // Only the driver and accepted riders may see the driver's phone number
  if ((ride.my_request && ride.my_request.status === 'accepted') || ride.is_mine) {
    ride.driver_phone = byId('users', ride.driver_id).phone;
  }
  return { ride };
});

route('DELETE', '/rides/:id', ({ params }) => {
  const me = requireLogin();
  const id = V.int(params[0], 'Ride id', { min: 1 });
  const ride = byId('rides', id);
  if (!ride) throw new LocalHttpError(404, 'Ride not found.');
  if (ride.driver_id !== me.id && !me.is_admin) throw new LocalHttpError(403, 'You can only delete your own rides.');
  removeRide(id);
  save();
  return { ok: true };
});

// ----- requests -----
route('POST', '/rides/:id/requests', ({ params, body }) => {
  const me = requireLogin();
  const rideId = V.int(params[0], 'Ride id', { min: 1 });
  const seats = V.int(body.seats ?? 1, 'Seats', { min: 1, max: 10 });
  const message = V.text(body.message, 'Message', { optional: true, max: 300 });

  const ride = byId('rides', rideId);
  if (!ride) throw new LocalHttpError(404, 'Ride not found.');
  if (ride.driver_id === me.id) throw bad('You cannot request a seat on your own ride.');
  if (isExpired(ride)) throw bad('This ride has already happened.');
  if (ride.seats_available < 1) throw bad('Sorry, this ride has no seats left.');
  if (seats > ride.seats_available) throw bad(`Only ${ride.seats_available} seat(s) left on this ride.`);
  if (db.requests.some((q) => q.ride_id === rideId && q.rider_id === me.id && ['pending', 'accepted'].includes(q.status)))
    throw new LocalHttpError(409, 'You already have an active request for this ride.');

  const id = newId('requests');
  db.requests.push({ id, ride_id: rideId, rider_id: me.id, seats_requested: seats, status: 'pending', message, created_at: nowStamp() });
  save();
  return { id, status: 'pending' };
});

route('GET', '/requests/mine', () => {
  const me = requireLogin();
  const today = todayStr();
  const requests = db.requests
    .filter((q) => q.rider_id === me.id)
    .map((q) => {
      const r = byId('rides', q.ride_id);
      const driver = byId('users', r.driver_id);
      return {
        id: q.id, ride_id: q.ride_id, seats_requested: q.seats_requested, status: q.status, message: q.message, created_at: q.created_at,
        origin_label: r.origin_label, dest_label: r.dest_label, ride_date: r.ride_date, depart_time: r.depart_time,
        cost_per_seat: r.cost_per_seat, driver_id: r.driver_id, driver_name: driver.name,
        driver_phone: q.status === 'accepted' ? driver.phone : null, // phone only after acceptance
        is_past: r.ride_date < today,
      };
    })
    .sort((a, b) => (a.ride_date < b.ride_date ? 1 : a.ride_date > b.ride_date ? -1 : b.id - a.id));
  return { requests };
});

route('GET', '/rides/:id/requests', ({ params }) => {
  const me = requireLogin();
  const rideId = V.int(params[0], 'Ride id', { min: 1 });
  const ride = byId('rides', rideId);
  if (!ride) throw new LocalHttpError(404, 'Ride not found.');
  if (ride.driver_id !== me.id) throw new LocalHttpError(403, 'Only the driver can see these requests.');
  const requests = db.requests
    .filter((q) => q.ride_id === rideId)
    .sort((a, b) => b.id - a.id)
    .map((q) => ({ ...q, rider_name: byId('users', q.rider_id).name, rider_phone: byId('users', q.rider_id).phone }));
  return { requests };
});

// Seats are taken only on accept, and given back only when an accepted request is cancelled.
route('PATCH', '/requests/:id', ({ params, body }) => {
  const me = requireLogin();
  const id = V.int(params[0], 'Request id', { min: 1 });
  const action = String(body.action || '');
  if (!['accept', 'decline', 'cancel'].includes(action)) throw bad('Action must be accept, decline or cancel.');

  const request = byId('requests', id);
  if (!request) throw new LocalHttpError(404, 'Request not found.');
  const ride = byId('rides', request.ride_id);

  if (action === 'accept' || action === 'decline') {
    if (ride.driver_id !== me.id) throw new LocalHttpError(403, 'Only the driver can do this.');
    if (request.status !== 'pending') throw bad(`This request is already ${request.status}.`);
    if (action === 'accept') {
      if (ride.seats_available < request.seats_requested) throw bad('Not enough seats left to accept this request.');
      ride.seats_available -= request.seats_requested;
    }
    request.status = action === 'accept' ? 'accepted' : 'declined';
  } else {
    if (request.rider_id !== me.id) throw new LocalHttpError(403, 'You can only cancel your own requests.');
    if (!['pending', 'accepted'].includes(request.status)) throw bad(`This request is already ${request.status}.`);
    if (request.status === 'accepted') ride.seats_available += request.seats_requested;
    request.status = 'cancelled';
  }
  save();
  return { id, status: request.status };
});

// ----- ratings -----
// Who may `userId` rate for this ride? Only after the ride date, driver <-> accepted riders.
function ratablePeople(ride, userId) {
  if (ride.ride_date >= todayStr()) return [];
  let people = [];
  if (ride.driver_id === userId) {
    const riderIds = [...new Set(db.requests.filter((q) => q.ride_id === ride.id && q.status === 'accepted').map((q) => q.rider_id))];
    people = riderIds.map((rid) => ({ user_id: rid, name: byId('users', rid).name }));
  } else if (db.requests.some((q) => q.ride_id === ride.id && q.rider_id === userId && q.status === 'accepted')) {
    people = [{ user_id: ride.driver_id, name: byId('users', ride.driver_id).name }];
  }
  return people.map((p) => ({
    ...p,
    already_rated: db.ratings.some((g) => g.ride_id === ride.id && g.rater_id === userId && g.ratee_id === p.user_id),
  }));
}

route('GET', '/rides/:id/ratable', ({ params }) => {
  const me = requireLogin();
  const ride = byId('rides', V.int(params[0], 'Ride id', { min: 1 }));
  if (!ride) throw new LocalHttpError(404, 'Ride not found.');
  return { people: ratablePeople(ride, me.id) };
});

route('POST', '/ratings', ({ body }) => {
  const me = requireLogin();
  const rideId = V.int(body.ride_id, 'Ride id', { min: 1 });
  const rateeId = V.int(body.ratee_id, 'User id', { min: 1 });
  const score = V.int(body.score, 'Rating', { min: 1, max: 5 });
  const comment = V.text(body.comment, 'Comment', { optional: true, max: 500 });

  const ride = byId('rides', rideId);
  if (!ride) throw new LocalHttpError(404, 'Ride not found.');
  if (ride.ride_date >= todayStr()) throw bad('You can rate only after the ride date has passed.');
  const allowed = ratablePeople(ride, me.id).find((p) => p.user_id === rateeId);
  if (!allowed) throw new LocalHttpError(403, 'You cannot rate this person for this ride.');
  if (allowed.already_rated) throw new LocalHttpError(409, 'You have already rated this person for this ride.');

  db.ratings.push({ id: newId('ratings'), ride_id: rideId, rater_id: me.id, ratee_id: rateeId, score, comment, created_at: nowStamp() });
  save();
  return { ok: true };
});

// ----- admin -----
route('GET', '/admin/users', () => {
  requireAdmin();
  const users = db.users.map((u) => ({
    id: u.id, name: u.name, email: u.email, phone: u.phone, organization: u.organization, is_admin: u.is_admin, created_at: u.created_at,
    rides_posted: db.rides.filter((r) => r.driver_id === u.id).length,
    requests_made: db.requests.filter((q) => q.rider_id === u.id).length,
  }));
  return { users };
});

route('DELETE', '/admin/users/:id', ({ params }) => {
  const me = requireAdmin();
  const id = V.int(params[0], 'User id', { min: 1 });
  if (id === me.id) throw bad('You cannot delete your own admin account.');
  if (!byId('users', id)) throw new LocalHttpError(404, 'User not found.');
  // cascade: their rides (with those rides' requests/ratings), requests and ratings
  db.rides.filter((r) => r.driver_id === id).forEach((r) => removeRide(r.id));
  db.requests = db.requests.filter((q) => q.rider_id !== id);
  db.ratings = db.ratings.filter((g) => g.rater_id !== id && g.ratee_id !== id);
  db.users = db.users.filter((u) => u.id !== id);
  save();
  return { ok: true };
});

route('GET', '/admin/rides', () => {
  requireAdmin();
  const rides = [...db.rides]
    .sort((a, b) => (a.ride_date < b.ride_date ? 1 : a.ride_date > b.ride_date ? -1 : b.id - a.id))
    .map((r) => ({
      id: r.id, origin_label: r.origin_label, dest_label: r.dest_label, ride_date: r.ride_date, depart_time: r.depart_time,
      total_seats: r.total_seats, seats_available: r.seats_available, cost_per_seat: r.cost_per_seat, driver_name: byId('users', r.driver_id).name,
    }));
  return { rides };
});

route('DELETE', '/admin/rides/:id', ({ params }) => {
  requireAdmin();
  const id = V.int(params[0], 'Ride id', { min: 1 });
  if (!byId('rides', id)) throw new LocalHttpError(404, 'Ride not found.');
  removeRide(id);
  save();
  return { ok: true };
});

// ----- geocoding -----
route('GET', '/geocode', async ({ query }) => {
  const q = V.text(query.get('q'), 'Search text', { min: 3, max: 150 });
  const params = new URLSearchParams({ q, format: 'jsonv2', limit: '5', addressdetails: '0', 'accept-language': 'en' });
  if (COUNTRY) params.set('countrycodes', COUNTRY);
  const data = await geoFetch(`${NOMINATIM}/search?${params}`);
  return { results: data.map((d) => ({ label: d.display_name, lat: Number(d.lat), lng: Number(d.lon) })) };
});

route('GET', '/geocode/reverse', async ({ query }) => {
  const lat = V.lat(query.get('lat'), 'Latitude');
  const lng = V.lng(query.get('lng'), 'Longitude');
  const params = new URLSearchParams({ lat: lat.toFixed(5), lon: lng.toFixed(5), format: 'jsonv2', zoom: '17', 'accept-language': 'en' });
  const data = await geoFetch(`${NOMINATIM}/reverse?${params}`);
  return { label: data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
});

// ---------- Entry point used by api.js ----------
// localApi('GET', '/rides/search?date=2026-01-01') -> the same JSON the Express server would return
async function localApi(method, path, body) {
  await init();
  const [pathname, queryString = ''] = path.split('?');
  for (const [m, regex, handler] of routes) {
    if (m !== method) continue;
    const match = pathname.match(regex);
    if (!match) continue;
    return handler({ params: match.slice(1).map(decodeURIComponent), query: new URLSearchParams(queryString), body: body || {} });
  }
  throw new LocalHttpError(404, 'Not found.');
}

window.localApi = localApi;
window.resetDemoData = resetDemoData;
})();
