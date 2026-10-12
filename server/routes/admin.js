// Admin routes: view and delete users and rides. (Router is protected in index.js.)
const express = require('express');
const db = require('../db');
const v = require('../utils/validate');

const router = express.Router();

router.get('/users', (req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.organization, u.is_admin, u.created_at,
              (SELECT COUNT(*) FROM rides WHERE driver_id = u.id) AS rides_posted,
              (SELECT COUNT(*) FROM ride_requests WHERE rider_id = u.id) AS requests_made
         FROM users u ORDER BY u.id`
    )
    .all();
  res.json({ users });
});

router.delete('/users/:id', (req, res) => {
  const id = v.int(req.params.id, 'User id', { min: 1 });
  if (id === req.user.id) throw new v.HttpError(400, 'You cannot delete your own admin account.');
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(id); // cascades to their rides, requests, ratings
  if (!info.changes) throw new v.HttpError(404, 'User not found.');
  res.json({ ok: true });
});

router.get('/rides', (req, res) => {
  const rides = db
    .prepare(
      `SELECT r.id, r.origin_label, r.dest_label, r.ride_date, r.depart_time, r.total_seats,
              r.seats_available, r.cost_per_seat, u.name AS driver_name
         FROM rides r JOIN users u ON u.id = r.driver_id
        ORDER BY r.ride_date DESC, r.id DESC`
    )
    .all();
  res.json({ rides });
});

router.delete('/rides/:id', (req, res) => {
  const id = v.int(req.params.id, 'Ride id', { min: 1 });
  const info = db.prepare('DELETE FROM rides WHERE id = ?').run(id);
  if (!info.changes) throw new v.HttpError(404, 'Ride not found.');
  res.json({ ok: true });
});

module.exports = router;
