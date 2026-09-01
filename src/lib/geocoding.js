const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'

// Member-triggered address lookup only—never autocomplete. Tandem creates
// very few physical locations, so a single explicit search per click stays
// within the public Nominatim service's low-volume usage model.
export async function searchUsAddresses(query) {
  const trimmed = query.trim()
  if (!trimmed) return []

  const params = new URLSearchParams({
    q: trimmed,
    format: 'jsonv2',
    addressdetails: '1',
    countrycodes: 'us',
    limit: '4',
  })
  const response = await fetch(`${NOMINATIM_SEARCH_URL}?${params}`)
  if (!response.ok) throw new Error('Address lookup is unavailable right now. Try again or use Advanced details.')
  const results = await response.json()
  return results
    .map((result) => ({
      id: result.place_id,
      label: result.display_name,
      latitude: Number(result.lat),
      longitude: Number(result.lon),
    }))
    .filter((result) => Number.isFinite(result.latitude) && Number.isFinite(result.longitude))
}
