// Turns whatever a failed call threw into a sentence a person can act on.
// UI/UX overhaul Phase 4: about a hundred places showed `err.message`
// verbatim, which for anything coming from the database, the network or an
// Edge Function is developer text ("new row violates row-level security
// policy for table \"tasks\"", "Failed to fetch", "Edge Function returned a
// non-2xx status code") that says neither what happened nor what to do.
//
// Messages this app wrote itself ("This unit already has a booking that
// overlaps those dates.", "Incorrect master password.") are already plain
// and pass through unchanged — only recognised technical shapes are
// replaced, and anything technical-looking we do not recognise falls back
// to a generic line rather than leaking raw text.
const GENERIC = 'Something went wrong. Please try again, and tell Aaron if it keeps happening.'

const TECHNICAL =
  /pgrst|relation "|column "|syntax error|violates|sqlstate|\bpg_|does not exist|schema cache|invalid input syntax|\bat character\b|^\s*[{[]/i

export function friendlyError(err, fallback = GENERIC) {
  // A browser geolocation failure (its codes 1-3 are numbers; database
  // codes are strings, so the typeof check keeps the two apart).
  if (typeof GeolocationPositionError !== 'undefined' && err instanceof GeolocationPositionError) {
    return err.code === 1
      ? 'Location is turned off for this site. Turn it on in your browser or phone settings, then try again.'
      : "Couldn't get your location. Move to somewhere with a clearer signal and try again."
  }

  const raw = (typeof err === 'string' ? err : err?.message || '').trim()
  if (!raw) return fallback
  const lower = raw.toLowerCase()
  const code = typeof err?.code === 'string' ? err.code : ''

  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|timed out|timeout/.test(lower)) {
    return "Couldn't reach Tandem. Check your internet connection and try again."
  }
  if (/invalid login credentials/.test(lower)) {
    return "That username or password isn't right. Check them and try again."
  }
  if (/jwt|refresh token|not authenticated|session.*(expired|missing)|token.*expired/.test(lower)) {
    return 'Your session has ended. Sign out and sign in again.'
  }
  if (code === '42501' || /row-level security|permission denied|not authorized|insufficient privilege/.test(lower)) {
    return "You don't have permission to do that. If you think you should, ask Aaron."
  }
  if (/already been registered|user already registered|email.*already/.test(lower)) {
    return 'That username is already taken. Pick a different one.'
  }
  if (code === '23505' || /duplicate key|already exists/.test(lower)) {
    return 'That already exists. Check for a duplicate and try again.'
  }
  if (code === '23503' || /foreign key/.test(lower)) {
    return "That can't be changed because something else still uses it."
  }
  if (code === '23514' || code === '23502' || /null value in column|violates check constraint/.test(lower)) {
    return "Some of that information isn't valid. Check the fields and try again."
  }
  if (/non-2xx|functionshttperror|functionsrelayerror|functionsfetcherror|edge function/.test(lower)) {
    return "That didn't go through. Please try again, and tell Aaron if it keeps happening."
  }
  if (TECHNICAL.test(raw)) return fallback
  return raw
}
