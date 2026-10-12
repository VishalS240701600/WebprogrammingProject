// Seed script: npm run seed
// Wipes the database and inserts demo users, rides, requests and ratings around Chennai.
// Dates are relative to today, so the demo data is always fresh.
//
// Demo logins (all passwords below):
//   admin@ridebuddy.test   / admin1234     (admin)
//   arjun@ridebuddy.test   / password123   (and priya@, karthik@, meena@, rahul@, divya@, sanjay@)

const bcrypt = require('bcrypt');
const db = require('../server/db'); // also creates the tables from schema.sql

// ---- helpers ----
const pad = (n) => String(n).padStart(2, '0');
function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Sample places in Chennai: [label, lat, lng]
const PLACES = {
  tambaram:   ['Tambaram Railway Station, Chennai', 12.9249, 80.1000],
  annaUniv:   ['Anna University, Guindy, Chennai', 13.0108, 80.2357],
  iitm:       ['IIT Madras, Chennai', 12.9916, 80.2336],
  velachery:  ['Velachery, Chennai', 12.9815, 80.2180],
  tidel:      ['Tidel Park, Taramani, Chennai', 12.9876, 80.2476],
  annaNagar:  ['Anna Nagar Tower, Chennai', 13.0850, 80.2101],
  porur:      ['Porur Junction, Chennai', 13.0382, 80.1565],
  guindy:     ['Guindy Industrial Estate, Chennai', 13.0067, 80.2206],
  omr:        ['Sholinganallur, OMR, Chennai', 12.9010, 80.2279],
  adyar:      ['Adyar Signal, Chennai', 13.0067, 80.2570],
  tnagar:     ['T. Nagar Bus Terminus, Chennai', 13.0418, 80.2341],
  central:    ['Chennai Central Railway Station', 13.0827, 80.2707],
  thandalam:  ['Rajalakshmi Engineering College, Thandalam', 12.9910, 80.0570],
  perungudi:  ['Perungudi, Chennai', 12.9650, 80.2461],
};

const hash = (pw) => bcrypt.hashSync(pw, 10);

// ---- wipe old data ----
db.exec(`
  DELETE FROM ratings; DELETE FROM ride_requests; DELETE FROM rides; DELETE FROM users;
  DELETE FROM sqlite_sequence WHERE name IN ('ratings','ride_requests','rides','users');
`);

// ---- users ----
const insertUser = db.prepare(
  `INSERT INTO users (email, password_hash, name, phone, organization, is_admin) VALUES (?, ?, ?, ?, ?, ?)`
);
const pw = hash('password123');
const user = {};
for (const [key, email, name, phone, org] of [
  ['arjun',  'arjun@ridebuddy.test',  'Arjun Kumar',  '9840011111', 'Anna University'],
  ['priya',  'priya@ridebuddy.test',  'Priya Sharma', '9840022222', 'Tidel Park IT Campus'],
  ['karthik','karthik@ridebuddy.test','Karthik Raj',  '9840033333', 'IIT Madras'],
  ['meena',  'meena@ridebuddy.test',  'Meena Iyer',   '9840044444', 'Anna University'],
  ['rahul',  'rahul@ridebuddy.test',  'Rahul Verma',  '9840055555', 'Tidel Park IT Campus'],
  ['divya',  'divya@ridebuddy.test',  'Divya Lakshmi','9840066666', 'IIT Madras'],
  ['sanjay', 'sanjay@ridebuddy.test', 'Sanjay Patel', '9840077777', 'Rajalakshmi Engineering College'],
]) {
  user[key] = Number(insertUser.run(email, pw, name, phone, org, 0).lastInsertRowid);
}
user.admin = Number(
  insertUser.run('admin@ridebuddy.test', hash('admin1234'), 'RideBuddy Admin', '9840000000', 'RideBuddy', 1).lastInsertRowid
);

// ---- rides ----
const insertRide = db.prepare(
  `INSERT INTO rides (driver_id, origin_label, origin_lat, origin_lng, dest_label, dest_lat, dest_lng,
                      ride_date, depart_time, recurring_days, total_seats, seats_available, cost_per_seat, notes)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
function addRide(driver, from, to, offset, time, seats, cost, { days = null, notes = null } = {}) {
  const [oLabel, oLat, oLng] = PLACES[from];
  const [dLabel, dLat, dLng] = PLACES[to];
  return Number(
    insertRide.run(user[driver], oLabel, oLat, oLng, dLabel, dLat, dLng,
      dayOffset(offset), time, days, seats, seats, cost, notes).lastInsertRowid
  );
}

const WEEKDAYS = 'Mon,Tue,Wed,Thu,Fri';
const ride = {
  // upcoming
  tambToAnna:   addRide('arjun',  'tambaram', 'annaUniv', 1, '08:00', 4, 40, { days: WEEKDAYS, notes: 'Honda City, AC. Pickup at the station exit.' }),
  velToTidel:   addRide('priya',  'velachery','tidel',    1, '08:30', 3, 30, { notes: 'Leaving sharp at 8:30. Music on, chat optional.' }),
  annaNToIitm:  addRide('karthik','annaNagar','iitm',     1, '07:45', 3, 50, { days: WEEKDAYS }),
  porurToGuindy:addRide('meena',  'porur',    'guindy',   2, '09:00', 2, 35, { notes: 'Small hatchback, 2 seats only.' }),
  omrToAnna:    addRide('rahul',  'omr',      'annaUniv', 2, '08:15', 2, 60, { days: WEEKDAYS, notes: 'Via Taramani and Velachery.' }),
  tambToTidel:  addRide('divya',  'tambaram', 'tidel',    1, '08:10', 3, 45),
  annaToTamb:   addRide('arjun',  'annaUniv', 'tambaram', 1, '17:30', 4, 40, { days: WEEKDAYS, notes: 'Evening return trip.' }),
  thandToGuindy:addRide('sanjay', 'thandalam','guindy',   3, '07:30', 3, 55, { notes: 'Leaving from the college main gate.' }),
  tnagarToCent: addRide('priya',  'tnagar',   'central',  3, '18:00', 2, 25),
  // past (so the rating feature can be demoed)
  pastA:        addRide('arjun',  'tambaram', 'annaUniv', -3, '08:00', 4, 40, { notes: 'Past ride for the rating demo.' }),
  pastB:        addRide('karthik','annaNagar','iitm',     -5, '07:45', 3, 50),
};

// ---- requests ----
const insertRequest = db.prepare(
  `INSERT INTO ride_requests (ride_id, rider_id, seats_requested, status, message) VALUES (?, ?, ?, ?, ?)`
);
const takeSeats = db.prepare('UPDATE rides SET seats_available = seats_available - ? WHERE id = ?');
function addRequest(rideId, rider, seats, status, message = null) {
  insertRequest.run(rideId, user[rider], seats, status, message);
  if (status === 'accepted') takeSeats.run(seats, rideId); // accepted requests hold seats
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

// ---- ratings (for the past rides) ----
const insertRating = db.prepare('INSERT INTO ratings (ride_id, rater_id, ratee_id, score, comment) VALUES (?, ?, ?, ?, ?)');
insertRating.run(ride.pastA, user.priya, user.arjun, 5, 'Very punctual and a smooth driver.');
insertRating.run(ride.pastA, user.arjun, user.priya, 4, 'Friendly co-passenger.');
insertRating.run(ride.pastA, user.meena, user.arjun, 5, 'Comfortable ride, would go again!');
insertRating.run(ride.pastB, user.rahul, user.karthik, 4, 'Good driver, a little late.');
// (Arjun has not yet rated Meena, and Karthik has not yet rated Rahul - try it in the app.)

console.log('Seeded RideBuddy demo data:');
console.log(`  ${Object.keys(user).length} users, ${Object.keys(ride).length} rides`);
console.log('  Login: arjun@ridebuddy.test / password123');
console.log('  Admin: admin@ridebuddy.test / admin1234');
