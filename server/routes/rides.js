// Ride routes: post, search (with matching), my rides, details, delete.
const express = require('express');
const db = require('../db');
const v = require('../utils/validate');
const { requireLogin } = require('../middleware/auth');
const { rankRides } = require('../utils/matching');

const router = express.Router();

// Every ride query joins the driver's name and average rating.
const RIDE_SELECT = `
  SELECT r.*, u.name AS driver_name, u.organization AS driver_org,
         (SELECT ROUND(AVG(score), 1) FROM ratings WHERE ratee_id = r.driver_id) AS driver_rating,
         (SELECT COUNT(*) FROM ratings WHERE ratee_id = r.driver_id) AS driver_rating_count
    FROM rides r JOIN users u ON u.id = r.driver_id`;

// A one-off ride is "past" once its date is before today. Recurring rides keep going.
const isPast = (ride) => !ride.recurring_days && ride.ride_date < v.today();

// ---------- Post a ride ----------
router.post('/', requireLogin, (req, res) => {
  const b = req.body;
  const ride = {
    origin_label: v.text(b.origin_label, 'Origin', { max: 200 }),
    origin_lat: v.lat(b.origin_lat, 'Origin latitude'),
    origin_lng: v.lng(b.origin_lng, 'Origin longitude'),
    dest_label: v.text(b.dest_label, 'Destination', { max: 200 }),
    dest_lat: v.lat(b.dest_lat, 'Destination latitude'),
    dest_lng: v.lng(b.dest_lng, 'Destination longitude'),
    ride_date: v.date(b.ride_date, 'Date'),
    depart_time: v.time(b.depart_time, 'Departure time'),
    recurring_days: v.days(b.recurring_days),
    total_seats: v.int(b.total_seats, 'Seats', { min: 1, max: 10 }),
    cost_per_seat: v.number(b.cost_per_seat ?? 0, 'Cost per seat', { min: 0, max: 100000 }),
    notes: v.text(b.notes, 'Notes', { optional: true, max: 500 }),
  };
  if (ride.ride_date < v.today()) throw new v.HttpError(400, 'The ride date cannot be in the past.');

  const info = db
    .prepare(
      `INSERT INTO rides (driver_id, origin_label, origin_lat, origin_lng, dest_label, dest_lat, dest_lng,
                          ride_date, depart_time, recurring_days, total_seats, seats_available,
                          cost_per_seat, notes)
       VALUES (@driver_id, @origin_label, @origin_lat, @origin_lng, @dest_label, @dest_lat, @dest_lng,
               @ride_date, @depart_time, @recurring_days, @total_seats, @total_seats,
               @cost_per_seat, @notes)`
    )
    .run({ ...ride, driver_id: req.user.id });

  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// ---------- Search rides (ranked by match score) ----------
// Query string: fromLat, fromLng, toLat, toLng, date, time, window (minutes)
router.get('/search', (req, res) => {
  const q = req.query;
  const has = (k) => q[k] !== undefined && q[k] !== '';

  const query = { windowMins: has('window') ? v.int(q.window, 'Time window', { min: 5, max: 720 }) : 60 };

  // Pickup / drop-off are optional but each must come as a lat+lng pair
  if (has('fromLat') || has('fromLng')) {
    query.fromLat = v.lat(q.fromLat, 'Pickup latitude');
    query.fromLng = v.lng(q.fromLng, 'Pickup longitude');
  }
  if (has('toLat') || has('toLng')) {
    query.toLat = v.lat(q.toLat, 'Drop-off latitude');
    query.toLng = v.lng(q.toLng, 'Drop-off longitude');
  }
  if (has('time')) query.time = v.time(q.time, 'Time');

  // Step 1: SQL narrows down by date and available seats.
  const today = v.today();
  let sql = RIDE_SELECT + ' WHERE r.seats_available > 0';
  const params = [];
  if (has('date')) {
    const date = v.date(q.date, 'Date');
    if (date < today) throw new v.HttpError(400, 'The search date cannot be in the past.');
    // Exact date match, OR a recurring ride that already started and runs on that weekday
    sql += ` AND (r.ride_date = ? OR (r.recurring_days IS NOT NULL AND r.ride_date <= ?
              AND instr(',' || r.recurring_days || ',', ',' || ? || ',') > 0))`;
    params.push(date, date, v.weekdayOf(date));
    query.date = date;
  } else {
    sql += ' AND (r.ride_date >= ? OR r.recurring_days IS NOT NULL)';
    params.push(today);
  }
  sql += ' LIMIT 500';

  // Step 2: the matching algorithm scores, filters and sorts the candidates in JS.
  const candidates = db.prepare(sql).all(...params);
  const results = rankRides(candidates, query);

  res.json({ results: results.slice(0, 50), count: results.length });
});

// ---------- Rides I posted, with incoming requests ----------
router.get('/mine', requireLogin, (req, res) => {
  const rides = db.prepare(RIDE_SELECT + ' WHERE r.driver_id = ? ORDER BY r.ride_date DESC, r.depart_time DESC')
    .all(req.user.id);
  const reqStmt = db.prepare(
    `SELECT q.*, u.name AS rider_name, u.phone AS rider_phone, u.organization AS rider_org
       FROM ride_requests q JOIN users u ON u.id = q.rider_id
      WHERE q.ride_id = ? ORDER BY q.created_at DESC, q.id DESC`
  );
  for (const ride of rides) {
    ride.requests = reqStmt.all(ride.id);
    ride.is_past = ride.ride_date < v.today();
  }
  res.json({ rides });
});

// ---------- One ride's details ----------
router.get('/:id', (req, res) => {
  const id = v.int(req.params.id, 'Ride id', { min: 1 });
  const ride = db.prepare(RIDE_SELECT + ' WHERE r.id = ?').get(id);
  if (!ride) throw new v.HttpError(404, 'Ride not found.');

  const userId = req.session && req.session.userId;
  ride.is_mine = userId === ride.driver_id;
  ride.is_past = ride.ride_date < v.today(); // the (first) ride date has passed: ratings allowed
  ride.is_expired = isPast(ride); // a one-off ride in the past: requests closed
  ride.my_request = userId
    ? db.prepare(
        `SELECT id, status, seats_requested FROM ride_requests
          WHERE ride_id = ? AND rider_id = ? ORDER BY id DESC LIMIT 1`
      ).get(id, userId) || null
    : null;

  // Only the driver and accepted riders may see the driver's phone number
  const accepted = ride.my_request && ride.my_request.status === 'accepted';
  if (accepted || ride.is_mine) {
    ride.driver_phone = db.prepare('SELECT phone FROM users WHERE id = ?').get(ride.driver_id).phone;
  }
  res.json({ ride });
});

// ---------- Delete a ride (owner or admin) ----------
router.delete('/:id', requireLogin, (req, res) => {
  const id = v.int(req.params.id, 'Ride id', { min: 1 });
  const ride = db.prepare('SELECT driver_id FROM rides WHERE id = ?').get(id);
  if (!ride) throw new v.HttpError(404, 'Ride not found.');
  if (ride.driver_id !== req.user.id && !req.user.is_admin) throw new v.HttpError(403, 'You can only delete your own rides.');
  db.prepare('DELETE FROM rides WHERE id = ?').run(id); // requests/ratings are removed by ON DELETE CASCADE
  res.json({ ok: true });
});

module.exports = router;
