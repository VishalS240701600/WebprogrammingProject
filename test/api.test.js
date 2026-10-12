// End-to-end API tests. Run with: npm test
// Starts the real server on a temporary database, then plays through the whole workflow.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { haversineKm } = require('../server/utils/geo');
const { scoreRide, rankRides } = require('../server/utils/matching');

const PORT = 3457;
const BASE = `http://localhost:${PORT}`;
const DB_FILE = path.join(os.tmpdir(), `ridebuddy-test-${Date.now()}.db`);
let server;

// A tiny HTTP client that remembers cookies, so each "person" has their own session.
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
}

const futureDate = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT, DB_PATH: DB_FILE },
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('running') && resolve());
    server.on('exit', () => reject(new Error('server exited early')));
    setTimeout(() => reject(new Error('server start timeout')), 10000);
  });
});

after(async () => {
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(DB_FILE + suffix, { force: true }); } catch (e) { /* temp file, ignore */ }
  }
});

// ---------- pure functions ----------
test('haversine distance is correct', () => {
  // Chennai Central -> Tambaram is roughly 24 km
  const km = haversineKm(13.0827, 80.2707, 12.9249, 80.1);
  assert.ok(km > 22 && km < 27, `got ${km}`);
  assert.equal(haversineKm(13, 80, 13, 80), 0);
});

test('matching ranks closer rides higher and filters far ones', () => {
  const base = { depart_time: '08:00', dest_lat: 13.0108, dest_lng: 80.2357 };
  const near = { id: 1, ...base, origin_lat: 12.93, origin_lng: 80.11 };
  const far = { id: 2, ...base, origin_lat: 13.2, origin_lng: 80.3 };
  const query = { fromLat: 12.925, fromLng: 80.1, toLat: 13.0108, toLng: 80.2357, time: '08:20', windowMins: 60 };
  assert.ok(scoreRide(near, query).score > 80);
  const ranked = rankRides([far, near], query);
  assert.deepEqual(ranked.map((r) => r.id), [1]); // "far" is beyond 10 km
});

// ---------- full workflow ----------
test('auth, validation, rides, requests, ratings and admin', async () => {
  const alice = client(); // driver
  const bob = client(); // rider
  const carol = client(); // second rider
  const anon = client();
  const reg = (c, name, email, extra = {}) => c('POST', '/api/auth/register', { name, email, password: 'password123', ...extra });

  // --- auth + validation
  assert.equal((await reg(alice, 'Alice', 'alice@test.dev', { organization: 'Anna Univ' })).status, 201);
  assert.equal((await reg(bob, 'Bob', 'bob@test.dev')).status, 201);
  assert.equal((await reg(carol, 'Carol', 'carol@test.dev')).status, 201);
  assert.equal((await reg(anon, 'Dup', 'ALICE@test.dev')).status, 409, 'duplicate email (case-insensitive)');
  assert.equal((await reg(anon, 'X', 'not-an-email')).status, 400);
  assert.equal((await anon('POST', '/api/auth/register', { name: 'X', email: 'x@test.dev', password: 'short' })).status, 400);
  assert.equal((await anon('POST', '/api/auth/login', { email: 'alice@test.dev', password: 'wrongpass1' })).status, 401);
  assert.equal((await alice('GET', '/api/auth/me')).body.user.email, 'alice@test.dev');
  assert.equal((await anon('GET', '/api/auth/me')).body.user, null);
  assert.equal((await anon('POST', '/api/rides', {})).status, 401, 'posting needs login');

  // --- posting a ride
  const ride = {
    origin_label: 'Tambaram', origin_lat: 12.9249, origin_lng: 80.1,
    dest_label: 'Anna University', dest_lat: 13.0108, dest_lng: 80.2357,
    ride_date: futureDate(2), depart_time: '08:00', total_seats: 2, cost_per_seat: 40,
  };
  assert.equal((await alice('POST', '/api/rides', { ...ride, total_seats: 0 })).status, 400);
  assert.equal((await alice('POST', '/api/rides', { ...ride, origin_lat: 200 })).status, 400);
  assert.equal((await alice('POST', '/api/rides', { ...ride, ride_date: '2020-01-01' })).status, 400);
  assert.equal((await alice('POST', '/api/rides', { ...ride, cost_per_seat: -5 })).status, 400);
  assert.equal((await alice('POST', '/api/rides', { ...ride, recurring_days: ['Funday'] })).status, 400);
  const posted = await alice('POST', '/api/rides', { ...ride, recurring_days: ['Wed', 'Mon'], notes: "<b>hi</b>'; DROP TABLE rides;--" });
  assert.equal(posted.status, 201);
  const rideId = posted.body.id;

  // a far-away ride that should not match Bob's search
  await alice('POST', '/api/rides', { ...ride, origin_lat: 13.4, origin_lng: 80.3, dest_lat: 13.5, dest_lng: 80.3, origin_label: 'Far', dest_label: 'Far2' });

  // --- search + matching
  const q = `fromLat=12.93&fromLng=80.11&toLat=13.01&toLng=80.23&date=${ride.ride_date}&time=08:15&window=60`;
  const found = await anon('GET', '/api/rides/search?' + q);
  assert.equal(found.status, 200);
  assert.equal(found.body.results.length, 1);
  assert.equal(found.body.results[0].id, rideId);
  assert.ok(found.body.results[0].match.score >= 80);
  assert.equal((await anon('GET', '/api/rides/search?fromLat=abc&fromLng=1')).status, 400);
  assert.equal((await anon('GET', '/api/rides/search?date=2001-01-01')).status, 400);
  assert.equal((await anon('GET', "/api/rides/search?time=08:00' OR 1=1--")).status, 400);

  // --- requests
  const detail = (await bob('GET', '/api/rides/' + rideId)).body.ride;
  assert.equal(detail.is_mine, false);
  assert.equal(detail.driver_phone, undefined, 'phone hidden until accepted');
  assert.equal((await alice('POST', `/api/rides/${rideId}/requests`, { seats: 1 })).status, 400, 'own ride');
  assert.equal((await anon('POST', `/api/rides/${rideId}/requests`, { seats: 1 })).status, 401);
  assert.equal((await bob('POST', `/api/rides/${rideId}/requests`, { seats: 5 })).status, 400, 'too many seats');
  const reqB = await bob('POST', `/api/rides/${rideId}/requests`, { seats: 2, message: 'Please!' });
  assert.equal(reqB.status, 201);
  assert.equal((await bob('POST', `/api/rides/${rideId}/requests`, { seats: 1 })).status, 409, 'duplicate active request');
  const reqC = await carol('POST', `/api/rides/${rideId}/requests`, { seats: 1 });
  assert.equal(reqC.status, 201);

  // permissions
  assert.equal((await bob('PATCH', `/api/requests/${reqB.body.id}`, { action: 'accept' })).status, 403, 'rider cannot accept');
  assert.equal((await carol('PATCH', `/api/requests/${reqB.body.id}`, { action: 'cancel' })).status, 403, 'cannot cancel others');
  assert.equal((await alice('PATCH', `/api/requests/${reqB.body.id}`, { action: 'explode' })).status, 400);

  // accept reduces seats; second accept fails (no seats)
  assert.equal((await alice('PATCH', `/api/requests/${reqB.body.id}`, { action: 'accept' })).body.status, 'accepted');
  assert.equal((await anon('GET', '/api/rides/' + rideId)).body.ride.seats_available, 0);
  assert.equal((await alice('PATCH', `/api/requests/${reqC.body.id}`, { action: 'accept' })).status, 400);
  assert.equal((await alice('PATCH', `/api/requests/${reqB.body.id}`, { action: 'accept' })).status, 400, 'already accepted');
  assert.equal((await anon('GET', '/api/rides/search?date=' + ride.ride_date)).body.results.filter((r) => r.id === rideId).length, 0, 'full rides are not listed');
  assert.equal((await bob('GET', '/api/rides/' + rideId)).body.ride.driver_phone, null, 'phone visible (empty) once accepted');

  // cancel restores seats
  assert.equal((await bob('PATCH', `/api/requests/${reqB.body.id}`, { action: 'cancel' })).body.status, 'cancelled');
  assert.equal((await anon('GET', '/api/rides/' + rideId)).body.ride.seats_available, 2);
  assert.equal((await bob('PATCH', `/api/requests/${reqB.body.id}`, { action: 'cancel' })).status, 400, 'cannot cancel twice');
  assert.equal((await alice('PATCH', `/api/requests/${reqC.body.id}`, { action: 'decline' })).body.status, 'declined');
  assert.equal((await anon('GET', '/api/rides/' + rideId)).body.ride.seats_available, 2, 'decline does not change seats');

  // dashboard data
  const mine = (await alice('GET', '/api/rides/mine')).body.rides.find((r) => r.id === rideId);
  assert.equal(mine.requests.length, 2);
  const bobReqs = (await bob('GET', '/api/requests/mine')).body.requests;
  assert.equal(bobReqs[0].status, 'cancelled');

  // can request again after cancelling
  assert.equal((await bob('POST', `/api/rides/${rideId}/requests`, { seats: 1 })).status, 201);

  // --- ratings (needs a ride in the past, so insert one straight into the test DB)
  const raw = new Database(DB_FILE);
  const ids = Object.fromEntries(raw.prepare('SELECT name, id FROM users').all().map((u) => [u.name, u.id]));
  const past = raw.prepare(
    `INSERT INTO rides (driver_id, origin_label, origin_lat, origin_lng, dest_label, dest_lat, dest_lng, ride_date, depart_time, total_seats, seats_available, cost_per_seat)
     VALUES (?, 'A', 13, 80, 'B', 13.1, 80.1, '2020-01-01', '08:00', 3, 2, 10)`
  ).run(ids.Alice).lastInsertRowid;
  raw.prepare(`INSERT INTO ride_requests (ride_id, rider_id, seats_requested, status) VALUES (?, ?, 1, 'accepted')`).run(past, ids.Bob);
  raw.prepare(`INSERT INTO ride_requests (ride_id, rider_id, seats_requested, status) VALUES (?, ?, 1, 'declined')`).run(past, ids.Carol);

  assert.equal((await bob('POST', '/api/ratings', { ride_id: rideId, ratee_id: ids.Alice, score: 5 })).status, 400, 'future ride');
  assert.equal((await bob('POST', '/api/ratings', { ride_id: past, ratee_id: ids.Alice, score: 6 })).status, 400, 'score out of range');
  assert.equal((await bob('POST', '/api/ratings', { ride_id: past, ratee_id: ids.Bob, score: 5 })).status, 403, 'self rating');
  assert.equal((await carol('POST', '/api/ratings', { ride_id: past, ratee_id: ids.Alice, score: 5 })).status, 403, 'declined rider cannot rate');
  assert.equal((await bob('POST', '/api/ratings', { ride_id: past, ratee_id: ids.Alice, score: 4, comment: 'Nice' })).status, 201);
  assert.equal((await bob('POST', '/api/ratings', { ride_id: past, ratee_id: ids.Alice, score: 4 })).status, 409, 'duplicate rating');
  assert.equal((await alice('POST', '/api/ratings', { ride_id: past, ratee_id: ids.Bob, score: 3 })).status, 201);
  assert.equal((await alice('POST', '/api/ratings', { ride_id: past, ratee_id: ids.Carol, score: 3 })).status, 403);
  const ratable = (await bob('GET', `/api/rides/${past}/ratable`)).body.people;
  assert.deepEqual(ratable.map((p) => [p.name, p.already_rated]), [['Alice', true]]);
  const profile = (await anon('GET', '/api/users/' + ids.Alice)).body.user;
  assert.equal(profile.avg_rating, 4);
  assert.equal(profile.rating_count, 1);
  assert.equal(profile.phone, undefined, 'phone is private');

  // --- profile edit
  assert.equal((await bob('PUT', '/api/users/me', { name: '', phone: '' })).status, 400);
  const edited = await bob('PUT', '/api/users/me', { name: 'Bobby', phone: '9876543210', organization: 'ACME' });
  assert.equal(edited.body.user.name, 'Bobby');
  assert.equal((await bob('PUT', '/api/users/me', { name: 'Bobby', new_password: 'newpassword1', current_password: 'nope' })).status, 400);

  // --- admin
  assert.equal((await bob('GET', '/api/admin/users')).status, 403);
  assert.equal((await anon('GET', '/api/admin/users')).status, 401);
  raw.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(ids.Carol);
  raw.close();
  assert.ok((await carol('GET', '/api/admin/users')).body.users.length >= 3);
  assert.equal((await carol('DELETE', `/api/admin/users/${ids.Carol}`)).status, 400, 'admin cannot delete self');
  assert.equal((await carol('DELETE', `/api/admin/rides/${rideId}`)).status, 200);
  assert.equal((await anon('GET', '/api/rides/' + rideId)).status, 404);
  assert.equal((await alice('DELETE', `/api/admin/users/${ids.Bob}`)).status, 403);
  assert.equal((await carol('DELETE', `/api/admin/users/${ids.Bob}`)).status, 200);
  assert.equal((await alice('DELETE', `/api/rides/${past}`)).status, 200, 'owner can delete own ride');

  // --- logout
  await alice('POST', '/api/auth/logout');
  assert.equal((await alice('GET', '/api/auth/me')).body.user, null);
  assert.equal((await anon('GET', '/api/nope')).status, 404);

});
