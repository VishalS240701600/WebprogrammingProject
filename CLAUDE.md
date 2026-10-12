# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

RideBuddy: a carpool finder (Node.js + Express, SQLite via better-sqlite3, vanilla JS frontend, Leaflet/OpenStreetMap). It is a web programming class project, so keep code clean, commented and easy for a student to explain. No frameworks or build step on the frontend.

## Commands

```bash
npm install
npm run seed     # WIPES db/ridebuddy.db and inserts Chennai demo data (dates relative to today)
npm start        # http://localhost:3000
npm run dev      # node --watch
npm test         # node --test test/api.test.js (starts the real server on port 3457 with a temp DB)
```

There is no linter or build step. `npm test` uses an explicit file path because Node 22 treats a bare directory argument as a module. To run one test, use `node --test --test-name-pattern="<name>" test/api.test.js`.

Demo logins: `arjun@ridebuddy.test` / `password123`, admin `admin@ridebuddy.test` / `admin1234`.

Env vars: `PORT`, `DB_PATH`, `SESSION_SECRET` (required when `NODE_ENV=production`), `NOMINATIM_USER_AGENT`, `NOMINATIM_COUNTRY` (default `in`).

## Architecture

- `server/index.js` mounts routers under `/api`. Routers `requests.js` and `ratings.js` are mounted at bare `/api` and define full paths (`/rides/:id/requests`, `/requests/:id`, `/ratings`, `/rides/:id/ratable`). The admin router is protected by `requireLogin, requireAdmin` at mount time. Leaflet is served from `node_modules` at `/vendor/leaflet`. Express 5 is used, so async handlers can throw without try/catch.
- **Errors:** handlers throw `HttpError(status, message)` (from `server/utils/validate.js`); `middleware/errors.js` turns them into `{ error }` JSON. Input validation helpers in the same file throw 400s, and every route validates through them. All SQL is parameterized.
- **Route order matters** in `routes/rides.js`: `/search` and `/mine` are declared before `/:id`.
- **Seat accounting** lives in the `changeStatus` transaction in `routes/requests.js`. Seats are taken only on *accept* and returned only when an *accepted* request is cancelled. The `rides` CHECK constraint (`0 <= seats_available <= total_seats`) is the backstop.
- **Matching** (`utils/matching.js`): SQL narrows by date and seats, then `rankRides` scores in JS (haversine from `utils/geo.js`; weights 0.4 pickup / 0.4 drop / 0.2 time, 10 km cutoff, weights re-normalised when fields are omitted).
- **Dates:** "today" is the server's local date (`v.today()`). One-off rides are expired when `ride_date < today` (`is_expired`, blocks requests). Rating eligibility uses `ride_date < today` even for recurring rides (`is_past`). A recurring ride matches a search date if it has started and `recurring_days` contains that weekday.
- **Geocoding:** the browser never calls Nominatim directly. `routes/geocode.js` proxies it with a User-Agent, a serialized queue (>= 1.1 s apart), an in-memory cache and a per-IP rate limit. `public/js/map.js` also debounces typing.
- **Privacy:** phone numbers are returned only to the owner/admin, or between a driver and an accepted rider (`/users/:id`, `/rides/:id`, `/requests/mine`).
- **Frontend:** one HTML page plus one script per page in `public/js/`. `api.js` is loaded everywhere and provides `api()`, `esc()`, `toast()`, `initPage()` (draws the navbar and handles the login/admin redirect). `map.js` has the Leaflet helpers and the `LocationPicker` class. `rating.js` is the shared rating dialog. Always pass user-supplied text through `esc()` before putting it in `innerHTML`.
- **Schema** is `db/schema.sql`, applied with `CREATE IF NOT EXISTS` by `server/db.js` on every start. There are no migrations, so changing an existing table requires re-seeding or deleting `db/ridebuddy.db`.

## Gotchas

- The `Referrer-Policy` header must stay `strict-origin-when-cross-origin`. With `same-origin`, OpenStreetMap blocks tile requests and the maps are blank.
- Sessions are in-memory, so they reset whenever the server restarts.
- Tests insert past-dated rides directly into the temp DB, because the API refuses to create rides in the past.
- In the Bash tool, long heredocs containing quotes tended to fail on this machine; the Write tool is more reliable for creating files.
