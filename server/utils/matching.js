// Ride matching algorithm.
//
// For each candidate ride we compute three sub-scores, each between 0 and 1:
//   pickupScore - how close the rider's pickup is to the driver's start point
//   dropScore   - how close the rider's drop-off is to the driver's destination
//   timeScore   - how close the departure time is to the rider's preferred time
// Each sub-score falls linearly from 1 (perfect) to 0 (at the cutoff).
// Final match score = 100 * (0.4*pickup + 0.4*drop + 0.2*time).

const { haversineKm, timeToMinutes } = require('./geo');

const MAX_DISTANCE_KM = 10; // beyond this distance a point scores 0
const WEIGHTS = { pickup: 0.4, drop: 0.4, time: 0.2 };

// Linear falloff: value 0 -> 1, value >= limit -> 0
const falloff = (value, limit) => Math.max(0, 1 - value / limit);

/**
 * @param ride   a row from the rides table
 * @param query  { fromLat, fromLng, toLat, toLng, time, windowMins }
 *               (any of the parts may be missing - missing parts are skipped)
 * @returns      { score, pickupKm, dropKm, timeDiffMins }
 */
function scoreRide(ride, query) {
  const parts = []; // [weight, subScore]
  const result = { pickupKm: null, dropKm: null, timeDiffMins: null };

  if (query.fromLat != null) {
    result.pickupKm = haversineKm(query.fromLat, query.fromLng, ride.origin_lat, ride.origin_lng);
    parts.push([WEIGHTS.pickup, falloff(result.pickupKm, MAX_DISTANCE_KM)]);
  }
  if (query.toLat != null) {
    result.dropKm = haversineKm(query.toLat, query.toLng, ride.dest_lat, ride.dest_lng);
    parts.push([WEIGHTS.drop, falloff(result.dropKm, MAX_DISTANCE_KM)]);
  }
  if (query.time) {
    result.timeDiffMins = Math.abs(timeToMinutes(ride.depart_time) - timeToMinutes(query.time));
    parts.push([WEIGHTS.time, falloff(result.timeDiffMins, query.windowMins)]);
  }

  // Re-normalise weights so a search with only some fields still scores 0-100
  const totalWeight = parts.reduce((sum, [w]) => sum + w, 0);
  const score = totalWeight
    ? (100 * parts.reduce((sum, [w, s]) => sum + w * s, 0)) / totalWeight
    : 50; // nothing to compare -> neutral score

  return { score: Math.round(score), ...result };
}

/**
 * Drop rides that are too far / outside the time window, then sort by
 * score (best first).
 */
function rankRides(rides, query) {
  return rides
    .map((ride) => ({ ...ride, match: scoreRide(ride, query) }))
    .filter((r) => {
      const m = r.match;
      if (m.pickupKm != null && m.pickupKm > MAX_DISTANCE_KM) return false;
      if (m.dropKm != null && m.dropKm > MAX_DISTANCE_KM) return false;
      if (m.timeDiffMins != null && m.timeDiffMins > query.windowMins) return false;
      return true;
    })
    .sort((a, b) => b.match.score - a.match.score);
}

module.exports = { scoreRide, rankRides, MAX_DISTANCE_KM };
