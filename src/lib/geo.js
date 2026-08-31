// Client-side geolocation helpers for the staff clock-in feature —
// purely for instant UI feedback ("you're 42m from Sunset Ave") before
// a clock-in is submitted. Never trusted as the source of truth for
// distance_from_site_m/flagged — that's recomputed server-side in
// schema.sql's stamp_time_entry_meta() trigger from the same formula,
// applied to the stored coordinates rather than anything the client
// reports about itself. Two independent implementations of the same
// math, on purpose — see that trigger's own comment for why.

// Great-circle distance between two lat/lng points, in meters.
export function haversineDistanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// The closest active work site to a given position, or null if there
// are none to compare against. Used to pre-select a site in
// StaffClockView.jsx's Start flow — a convenience default, not a hard
// gate, since a bad GPS fix or a legitimately-not-nearest site
// shouldn't block starting a shift (the manual <select> is always
// available as an override).
export function findNearestSite(sites, lat, lng) {
  if (!sites?.length) return null
  let nearest = null
  for (const site of sites) {
    const distanceM = haversineDistanceM(lat, lng, site.latitude, site.longitude)
    if (!nearest || distanceM < nearest.distanceM) nearest = { site, distanceM }
  }
  return nearest
}
