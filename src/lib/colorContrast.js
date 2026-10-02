// Picks readable label text for a background that is not known in advance
// — a member's badge colour, a rental unit's calendar colour (the unit
// colour is a free colour-picker choice). Returns white or the app's dark
// "ink", whichever has the higher WCAG contrast against `background`.
// UI/UX overhaul Phase 4: white on three of the five default member colours
// (and on the grey fallback) was only 3.3-3.4:1 for 11px badge text.
const INK = '#2a1c0a'
const WHITE = '#ffffff'

function channel(value) {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function ratio(a, b) {
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

export function readableTextColor(background) {
  const bg = typeof background === 'string' ? luminance(background) : null
  // Not a plain hex (an unexpected value): keep the long-standing white.
  if (bg == null) return WHITE
  return ratio(luminance(WHITE), bg) >= ratio(luminance(INK), bg) ? WHITE : INK
}
