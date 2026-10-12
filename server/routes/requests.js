// Request workflow: rider requests seats -> driver accepts/declines -> rider may cancel.
// Mounted at /api (so the paths below are full API paths).
const express = require('express');
const db = require('../db');
const v = require('../utils/validate');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// Rider asks for seats on a ride
router.post('/rides/:id/requests', requireLogin, (req, res) => {
  const rideId = v.int(req.params.id, 'Ride id', { min: 1 });
  const seats = v.int(req.body.seats ?? 1, 'Seats', { min: 1, max: 10 });
  const message = v.text(req.body.message, 'Message', { optional: true, max: 300 });

  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
  if (!ride) throw new v.HttpError(404, 'Ride not found.');
  if (ride.driver_id === req.user.id) throw new v.HttpError(400, 'You cannot request a seat on your own ride.');
  if (!ride.recurring_days && ride.ride_date < v.today()) throw new v.HttpError(400, 'This ride has already happened.');
  if (ride.seats_available < 1) throw new v.HttpError(400, 'Sorry, this ride has no seats left.');
  if (seats > ride.seats_available) throw new v.HttpError(400, `Only ${ride.seats_available} seat(s) left on this ride.`);

  const existing = db
    .prepare(`SELECT 1 FROM ride_requests WHERE ride_id = ? AND rider_id = ? AND status IN ('pending','accepted')`)
    .get(rideId, req.user.id);
  if (existing) throw new v.HttpError(409, 'You already have an active request for this ride.');

  const info = db
    .prepare('INSERT INTO ride_requests (ride_id, rider_id, seats_requested, message) VALUES (?, ?, ?, ?)')
    .run(rideId, req.user.id, seats, message);
  res.status(201).json({ id: Number(info.lastInsertRowid), status: 'pending' });
});

// Requests I have made (with ride + driver info)
router.get('/requests/mine', requireLogin, (req, res) => {
  const requests = db
    .prepare(
      `SELECT q.id, q.ride_id, q.seats_requested, q.status, q.message, q.created_at,
              r.origin_label, r.dest_label, r.ride_date, r.depart_time, r.cost_per_seat, r.driver_id,
              u.name AS driver_name,
              CASE WHEN q.status = 'accepted' THEN u.phone END AS driver_phone
         FROM ride_requests q
         JOIN rides r ON r.id = q.ride_id
         JOIN users u ON u.id = r.driver_id
        WHERE q.rider_id = ?
        ORDER BY r.ride_date DESC, q.id DESC`
    )
    .all(req.user.id);
  const today = v.today();
  for (const r of requests) r.is_past = r.ride_date < today;
  res.json({ requests });
});

// Requests on one of my rides
router.get('/rides/:id/requests', requireLogin, (req, res) => {
  const rideId = v.int(req.params.id, 'Ride id', { min: 1 });
  const ride = db.prepare('SELECT driver_id FROM rides WHERE id = ?').get(rideId);
  if (!ride) throw new v.HttpError(404, 'Ride not found.');
  if (ride.driver_id !== req.user.id) throw new v.HttpError(403, 'Only the driver can see these requests.');
  const requests = db
    .prepare(
      `SELECT q.*, u.name AS rider_name, u.phone AS rider_phone
         FROM ride_requests q JOIN users u ON u.id = q.rider_id
        WHERE q.ride_id = ? ORDER BY q.id DESC`
    )
    .all(rideId);
  res.json({ requests });
});

// Change a request's status: { action: 'accept' | 'decline' | 'cancel' }
//   accept / decline - driver only, request must be pending
//   cancel           - rider only, request must be pending or accepted
// Everything runs inside a transaction so the seat count can never get out of sync.
const changeStatus = db.transaction((requestId, userId, action) => {
  const request = db.prepare('SELECT * FROM ride_requests WHERE id = ?').get(requestId);
  if (!request) throw new v.HttpError(404, 'Request not found.');
  const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(request.ride_id);

  if (action === 'accept' || action === 'decline') {
    if (ride.driver_id !== userId) throw new v.HttpError(403, 'Only the driver can do this.');
    if (request.status !== 'pending') throw new v.HttpError(400, `This request is already ${request.status}.`);

    if (action === 'decline') {
      db.prepare(`UPDATE ride_requests SET status = 'declined' WHERE id = ?`).run(requestId);
      return 'declined';
    }
    // Accept: take the seats only if enough are still free
    const taken = db
      .prepare('UPDATE rides SET seats_available = seats_available - ? WHERE id = ? AND seats_available >= ?')
      .run(request.seats_requested, ride.id, request.seats_requested);
    if (taken.changes === 0) throw new v.HttpError(400, 'Not enough seats left to accept this request.');
    db.prepare(`UPDATE ride_requests SET status = 'accepted' WHERE id = ?`).run(requestId);
    return 'accepted';
  }

  // cancel
  if (request.rider_id !== userId) throw new v.HttpError(403, 'You can only cancel your own requests.');
  if (!['pending', 'accepted'].includes(request.status)) throw new v.HttpError(400, `This request is already ${request.status}.`);
  if (request.status === 'accepted') {
    // Give the seats back (only accepted requests had taken seats)
    db.prepare('UPDATE rides SET seats_available = seats_available + ? WHERE id = ?').run(request.seats_requested, ride.id);
  }
  db.prepare(`UPDATE ride_requests SET status = 'cancelled' WHERE id = ?`).run(requestId);
  return 'cancelled';
});

router.patch('/requests/:id', requireLogin, (req, res) => {
  const id = v.int(req.params.id, 'Request id', { min: 1 });
  const action = String(req.body.action || '');
  if (!['accept', 'decline', 'cancel'].includes(action)) {
    throw new v.HttpError(400, 'Action must be accept, decline or cancel.');
  }
  const status = changeStatus(id, req.user.id, action);
  res.json({ id, status });
});

module.exports = router;
