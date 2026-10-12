// Geo + time helpers used by the matching algorithm.

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

// Haversine formula: great-circle distance between two lat/lng points, in km.
function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

// "HH:MM" -> minutes since midnight
function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

module.exports = { haversineKm, timeToMinutes };
