// Ratings: after a ride's date has passed, the driver and the accepted riders
// can rate each other (1-5 stars + optional comment). Mounted at /api.
const express = require('express');
const db = require('../db');
const v = require('../utils/validate');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// Who may `userId` rate for this ride? Returns [{ user_id, name, already_rated }]
function ratablePeople(ride, userId) {
  if (ride.ride_date >= v.today()) return []; // ride hasn't happened yet

  let people = [];
  if (ride.driver_id === userId) {
    // Driver rates every rider they accepted
    people = db
      .prepare(
        `SELECT DISTINCT u.id AS user_id, u.name FROM ride_requests q
           JOIN users u ON u.id = q.rider_id
          WHERE q.ride_id = ? AND q.status = 'accepted'`
      )
      .all(ride.id);
  } else {
    // An accepted rider rates the driver
    const accepted = db
      .prepare(`SELECT 1 FROM ride_requests WHERE ride_id = ? AND rider_id = ? AND status = 'accepted'`)
      .get(ride.id, userId);
    if (accepted) {
      people = db.prepare('SELECT id AS user_id, name FROM users WHERE id = ?').all(ride.driver_id);
    }
  }
  const done = db.prepare('SELECT 1 FROM ratings WHERE ride_id = ? AND rater_id = ? AND ratee_id = ?');
  return people.map((p) => ({ ...p, already_rated: !!done.get(ride.id, userId, p.user_id) }));
}

// People I can still rate (or have rated) for a ride
router.get('/rides/:id/ratable', requireLogin, (req, res) => {
  const id = v.int(req.params.id, 'Ride id', { min: 1 });
  const ride = db.prepare('SELECT id, driver_id, ride_date FROM rides WHERE id = ?').get(id);
  if (!ride) throw new v.HttpError(404, 'Ride not found.');
  res.json({ people: ratablePeople(ride, req.user.id) });
});

// Submit a rating
router.post('/ratings', requireLogin, (req, res) => {
  const rideId = v.int(req.body.ride_id, 'Ride id', { min: 1 });
  const rateeId = v.int(req.body.ratee_id, 'User id', { min: 1 });
  const score = v.int(req.body.score, 'Rating', { min: 1, max: 5 });
  const comment = v.text(req.body.comment, 'Comment', { optional: true, max: 500 });

  const ride = db.prepare('SELECT id, driver_id, ride_date FROM rides WHERE id = ?').get(rideId);
  if (!ride) throw new v.HttpError(404, 'Ride not found.');
  if (ride.ride_date >= v.today()) throw new v.HttpError(400, 'You can rate only after the ride date has passed.');

  const allowed = ratablePeople(ride, req.user.id).find((p) => p.user_id === rateeId);
  if (!allowed) throw new v.HttpError(403, 'You cannot rate this person for this ride.');
  if (allowed.already_rated) throw new v.HttpError(409, 'You have already rated this person for this ride.');

  db.prepare('INSERT INTO ratings (ride_id, rater_id, ratee_id, score, comment) VALUES (?, ?, ?, ?, ?)')
    .run(rideId, req.user.id, rateeId, score, comment);
  res.status(201).json({ ok: true });
});

module.exports = router;
