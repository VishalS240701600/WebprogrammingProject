# RideBuddy 🚗 – Carpool Finder for College/Office Commutes

A web programming class project. Drivers post rides, riders search for the best match, request seats, and rate each other afterwards. Demo data is set in **Chennai**.

**Stack:** Node.js + Express · SQLite (`better-sqlite3`) · plain HTML/CSS/vanilla JS · Leaflet + OpenStreetMap · Nominatim geocoding · `express-session` + `bcrypt`.

## Setup

Requires Node.js 18+ (developed on Node 22).

```bash
npm install
npm run seed     # creates db/ridebuddy.db with demo users and rides
npm start        # http://localhost:3000
npm test         # runs the API test suite (uses a temporary database)
```

An internet connection is needed for map tiles and address search.

### Demo logins

| Role  | Email                    | Password      |
|-------|--------------------------|---------------|
| User  | `arjun@ridebuddy.test`   | `password123` |
| User  | `priya@ridebuddy.test` (also `karthik@`, `meena@`, `rahul@`, `divya@`, `sanjay@`) | `password123` |
| Admin | `admin@ridebuddy.test`   | `admin1234`   |

`npm run seed` wipes and recreates the demo data (dates are relative to today). It includes past rides so you can try ratings, and requests in every status.

### Optional environment variables

| Variable | Purpose |
|---|---|
| `PORT` | Server port (default 3000) |
| `SESSION_SECRET` | Cookie-signing secret (**required** when `NODE_ENV=production`) |
| `DB_PATH` | Alternative SQLite file location |
| `NOMINATIM_USER_AGENT` | User-Agent sent to Nominatim (set it to your own contact info) |
| `NOMINATIM_COUNTRY` | Country-code bias for address search (default `in`; empty to disable) |

## Features

1. **Auth** – register, login, logout. No fixed roles: every user can drive and ride. Profile page with edit form (name, phone, organization, optional password change).
2. **Post a ride** – origin/destination chosen by address search *or* map click (stored as lat/lng + text label), date, time, optional recurring days, seats, cost per seat, notes.
3. **Search with matching** – by pickup, drop-off, date and time window; results ranked by a match score (see below).
4. **Request workflow** – rider requests seats → driver accepts/declines. Accepting reduces available seats; cancelling an accepted request restores them. Statuses: `pending`, `accepted`, `declined`, `cancelled`.
5. **Dashboard** – "My posted rides" (with incoming requests) and "My requested rides" (with status).
6. **Ratings** – after a ride's date has passed, the driver and accepted riders can rate each other 1–5 with an optional comment. Average rating shows on profiles and ride cards.
7. **Maps** – ride details show origin/destination markers with a line; search shows results as numbered markers.
8. **Admin page** – view and delete users and rides (`is_admin` flag).

The request button is disabled for your own rides, rides with no seats left, and rides that already happened.

### The matching algorithm (`server/utils/matching.js`)

For each candidate ride (SQL first narrows by date and seats > 0):

```
pickupScore = max(0, 1 - haversineKm(rider pickup,  ride start) / 10)
dropScore   = max(0, 1 - haversineKm(rider dropoff, ride end)   / 10)
timeScore   = max(0, 1 - |departure - preferred time| / window)
score       = 100 * (0.4*pickup + 0.4*drop + 0.2*time)
```

Rides further than 10 km from either point, or outside the time window, are dropped. If the rider leaves a field blank, that part is skipped and the weights are re-normalised. Results are sorted best first.

### Security notes

- All input is validated server-side (`server/utils/validate.js`); every SQL statement is parameterized.
- Passwords hashed with bcrypt; sessions in an `httpOnly`, `sameSite=lax` cookie; session id regenerated on login; login/register rate-limited.
- User text is HTML-escaped before display (`esc()` in `public/js/api.js`).
- Phone numbers are shown only to the account owner, or between driver and accepted rider.
- Nominatim is called **through the server** (`/api/geocode`): it sets a User-Agent, spaces calls ≥ 1.1 s apart, caches results, and rate-limits each visitor; the browser also debounces typing (700 ms).
- Sessions are kept in memory, so they reset when the server restarts (fine for a class project).

## Folder structure

```
.
├── db/
│   ├── schema.sql          tables, constraints, indexes
│   ├── seed.js             demo data (Chennai)
│   └── ridebuddy.db        generated (git-ignored)
├── server/
│   ├── index.js            Express app, sessions, route mounting
│   ├── db.js               SQLite connection + schema loading
│   ├── middleware/         auth.js (requireLogin/Admin), errors.js
│   ├── routes/             auth, users, rides, requests, ratings, admin, geocode
│   └── utils/              validate.js, geo.js (haversine), matching.js
├── public/
│   ├── *.html              index, login, register, post-ride, ride, dashboard, profile, admin
│   ├── css/style.css
│   └── js/                 api.js (shared helpers + navbar), map.js (Leaflet helpers),
│                           rating.js, and one script per page
├── test/api.test.js        end-to-end API tests
└── package.json
```

## ER diagram (text)

```
users 1 ────< rides            (rides.driver_id → users.id)
users 1 ────< ride_requests    (ride_requests.rider_id → users.id)
rides 1 ────< ride_requests    (ride_requests.ride_id → rides.id)
rides 1 ────< ratings          (ratings.ride_id → rides.id)
users 1 ────< ratings          (as rater: rater_id, and as ratee: ratee_id)
```

```
users          id PK, email UNIQUE, password_hash, name, phone, organization, is_admin, created_at
rides          id PK, driver_id FK→users, origin_label/lat/lng, dest_label/lat/lng,
               ride_date, depart_time, recurring_days, total_seats, seats_available,
               cost_per_seat, notes, created_at
               CHECK: 0 ≤ seats_available ≤ total_seats, cost_per_seat ≥ 0, lat/lng ranges
ride_requests  id PK, ride_id FK→rides, rider_id FK→users, seats_requested ≥ 1,
               status ∈ {pending, accepted, declined, cancelled}, message, created_at
               UNIQUE (ride_id, rider_id) among active (pending/accepted) requests
ratings        id PK, ride_id FK→rides, rater_id FK→users, ratee_id FK→users,
               score CHECK 1..5, comment, created_at
               UNIQUE (ride_id, rater_id, ratee_id), CHECK rater_id <> ratee_id
```

A user can be a driver (many rides) and a rider (many requests) at the same time. All foreign keys use `ON DELETE CASCADE`, so deleting a user or ride removes the dependent rows.

## API endpoints

All bodies/responses are JSON; errors look like `{ "error": "message" }`.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | – | Create account and log in |
| POST | `/api/auth/login` | – | Log in |
| POST | `/api/auth/logout` | – | Log out |
| GET | `/api/auth/me` | – | Current user or `null` |
| GET | `/api/users/:id` | – | Public profile + average rating (phone only for self/admin) |
| GET | `/api/users/:id/ratings` | – | Ratings received |
| PUT | `/api/users/me` | login | Edit own profile / change password |
| POST | `/api/rides` | login | Post a ride |
| GET | `/api/rides/search` | – | Ranked search (`fromLat, fromLng, toLat, toLng, date, time, window`) |
| GET | `/api/rides/mine` | login | My posted rides with their requests |
| GET | `/api/rides/:id` | – | Ride details (+ my request, if any) |
| DELETE | `/api/rides/:id` | owner/admin | Delete a ride |
| POST | `/api/rides/:id/requests` | login | Request seats `{ seats, message }` |
| GET | `/api/rides/:id/requests` | driver | Requests for my ride |
| GET | `/api/requests/mine` | login | Requests I made |
| PATCH | `/api/requests/:id` | login | `{ action: "accept" \| "decline" \| "cancel" }` (driver: accept/decline; rider: cancel) |
| GET | `/api/rides/:id/ratable` | login | People I can rate for this ride |
| POST | `/api/ratings` | login | `{ ride_id, ratee_id, score, comment }` |
| GET | `/api/geocode?q=` | – | Address search (Nominatim proxy) |
| GET | `/api/geocode/reverse?lat=&lng=` | – | Coordinates → address |
| GET | `/api/admin/users` · `/api/admin/rides` | admin | List all |
| DELETE | `/api/admin/users/:id` · `/api/admin/rides/:id` | admin | Delete |

## Design decisions worth explaining in class

- **Seat accounting in a transaction** (`routes/requests.js`): accept/cancel update the request and the ride's seat count together, so they can never disagree. Seats are only taken when the driver *accepts*, and only accepted requests give seats back when cancelled.
- **Recurring rides** are stored as a day list (`Mon,Wed,Fri`). A search date matches a ride if it is the ride's date, or if the ride is recurring, has started, and runs on that weekday.
- **"Ride date has passed"** (for ratings) means `ride_date` is before today.
