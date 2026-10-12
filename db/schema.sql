-- RideBuddy database schema (SQLite)
-- Run automatically by server/db.js and db/seed.js (CREATE IF NOT EXISTS).

PRAGMA foreign_keys = ON;

-- Users: any user can be both a driver and a rider, so there is no "role" column.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  name          TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  phone         TEXT,
  organization  TEXT,                       -- college or company
  is_admin      INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Rides: posted by a driver. Locations are stored as a text label + lat/lng.
CREATE TABLE IF NOT EXISTS rides (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin_label    TEXT    NOT NULL,
  origin_lat      REAL    NOT NULL CHECK (origin_lat BETWEEN -90 AND 90),
  origin_lng      REAL    NOT NULL CHECK (origin_lng BETWEEN -180 AND 180),
  dest_label      TEXT    NOT NULL,
  dest_lat        REAL    NOT NULL CHECK (dest_lat BETWEEN -90 AND 90),
  dest_lng        REAL    NOT NULL CHECK (dest_lng BETWEEN -180 AND 180),
  ride_date       TEXT    NOT NULL,         -- YYYY-MM-DD
  depart_time     TEXT    NOT NULL,         -- HH:MM (24h)
  recurring_days  TEXT,                     -- e.g. 'Mon,Wed,Fri' or NULL
  total_seats     INTEGER NOT NULL CHECK (total_seats BETWEEN 1 AND 10),
  seats_available INTEGER NOT NULL,
  cost_per_seat   REAL    NOT NULL DEFAULT 0 CHECK (cost_per_seat >= 0),
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (seats_available >= 0 AND seats_available <= total_seats)
);
CREATE INDEX IF NOT EXISTS idx_rides_date   ON rides(ride_date);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id);

-- Requests: a rider asks for seats on a ride; the driver accepts/declines.
CREATE TABLE IF NOT EXISTS ride_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id         INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  rider_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seats_requested INTEGER NOT NULL DEFAULT 1 CHECK (seats_requested BETWEEN 1 AND 10),
  status          TEXT    NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  message         TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
-- A rider can only have ONE active (pending/accepted) request per ride.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_request
  ON ride_requests(ride_id, rider_id) WHERE status IN ('pending', 'accepted');
CREATE INDEX IF NOT EXISTS idx_requests_rider ON ride_requests(rider_id);

-- Ratings: rater scores ratee for a specific ride (1-5, optional comment).
CREATE TABLE IF NOT EXISTS ratings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id    INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  rater_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ratee_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score      INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (ride_id, rater_id, ratee_id),
  CHECK (rater_id <> ratee_id)
);
CREATE INDEX IF NOT EXISTS idx_ratings_ratee ON ratings(ratee_id);
