// Turns whatever someone typed into a web address into an href that is safe
// to put on a clickable link, or '' when it should not be a link at all.
//
// Vault entries are shared between members, and the URL is free text. A
// `javascript:` address on a link runs script in Tandem's own page when
// clicked, so only http and https links are ever made clickable. A bare
// address with no scheme ("example.com", "router.local:8080/admin") gets
// https:// added, which is what the person meant.
export function webLinkHref(raw) {
  const text = String(raw ?? '').trim()
  if (!text || /[\s<>"'`]/.test(text)) return ''
  // "something:" followed by a non-digit is a scheme (javascript:, data:,
  // mailto:, file:, ...); "host:8080" is a host and port, not a scheme.
  const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text)
  let url
  try {
    url = new URL(hasScheme ? text : `https://${text}`)
  } catch {
    return ''
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
  if (!url.hostname) return ''
  return url.href
}
