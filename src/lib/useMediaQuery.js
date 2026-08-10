import { useEffect, useState } from 'react'

// The one JS-driven responsive branch in the app — everywhere else
// (task-board-nav, Modal's mobile/desktop split, etc.) is one markup
// repositioned via CSS media queries alone. That works when both layouts
// are the same content differently arranged; Rentals' desktop dashboard
// vs. its mobile tabs are genuinely different structures (three
// always-mounted columns vs. one tab-switched panel), not a CSS
// rearrangement of the same tree, so picking which tree to render at all
// has to happen in JS.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
