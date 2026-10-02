// One-time codes (TOTP, RFC 6238) for vault entries — the same 6-digit,
// 30-second codes Google Authenticator shows. Runs entirely in the browser
// with the Web Crypto API; the secret never leaves the (already encrypted)
// vault entry it is stored in.
//
// An entry stores `totp: { secret, algorithm, digits, period }`: `secret` is
// the base32 setup key a site shows when you enable an authenticator app,
// the other three are the standard parameters (almost every site uses
// SHA1 / 6 / 30, which are the defaults).

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const ALGORITHMS = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }

export const TOTP_DEFAULTS = { algorithm: 'SHA1', digits: 6, period: 30 }

function base32ToBytes(input) {
  const clean = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
  if (!clean) throw new Error('Enter the setup key the site showed you.')
  let bits = 0
  let value = 0
  const out = []
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch)
    if (idx === -1) {
      throw new Error("That setup key has characters that aren't allowed. It should be letters A–Z and numbers 2–7.")
    }
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  if (out.length < 5) throw new Error('That setup key looks too short. Copy the whole key from the site.')
  return Uint8Array.from(out)
}

function normalizeSecret(secret) {
  base32ToBytes(secret) // validates
  return secret.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
}

// Accepts either the bare setup key ("JBSW Y3DP EHPK 3PXP") or the full
// otpauth:// link a QR code contains. Returns a normalized config, or
// throws an Error whose message is already plain language.
export function parseTotpInput(text) {
  const raw = (text || '').trim()
  if (!raw) throw new Error('Enter the setup key the site showed you.')

  if (/^otpauth:/i.test(raw)) {
    let url
    try {
      url = new URL(raw)
    } catch {
      throw new Error("That link isn't a valid authenticator link.")
    }
    if (url.hostname.toLowerCase() !== 'totp') {
      throw new Error('Only time-based codes (the usual kind) are supported.')
    }
    const p = url.searchParams
    const algorithm = (p.get('algorithm') || TOTP_DEFAULTS.algorithm).toUpperCase()
    const digits = Number(p.get('digits') || TOTP_DEFAULTS.digits)
    const period = Number(p.get('period') || TOTP_DEFAULTS.period)
    if (!ALGORITHMS[algorithm]) throw new Error(`This site uses a code type (${algorithm}) that isn't supported.`)
    if (![6, 7, 8].includes(digits)) throw new Error("This site's code length isn't supported.")
    if (!Number.isInteger(period) || period < 10 || period > 120) throw new Error("This site's code timing isn't supported.")
    return { secret: normalizeSecret(p.get('secret') || ''), algorithm, digits, period }
  }

  return { secret: normalizeSecret(raw), ...TOTP_DEFAULTS }
}

// The form shows what the person originally pasted. A standard config is
// just the key; anything unusual round-trips as a link so no parameter is
// lost when the entry is edited and saved again.
export function totpToInput(totp) {
  if (!totp) return ''
  const standard =
    (totp.algorithm || 'SHA1') === TOTP_DEFAULTS.algorithm &&
    (totp.digits || 6) === TOTP_DEFAULTS.digits &&
    (totp.period || 30) === TOTP_DEFAULTS.period
  return standard ? totp.secret : totpToUri(totp)
}

// Standard otpauth:// link, which any authenticator app can import — also
// what the CSV export writes, so leaving Tandem never strands the secret.
export function totpToUri(totp, { label = 'Tandem', issuer = '' } = {}) {
  const params = new URLSearchParams({ secret: totp.secret })
  if (issuer) params.set('issuer', issuer)
  if ((totp.algorithm || 'SHA1') !== TOTP_DEFAULTS.algorithm) params.set('algorithm', totp.algorithm)
  if ((totp.digits || 6) !== TOTP_DEFAULTS.digits) params.set('digits', String(totp.digits))
  if ((totp.period || 30) !== TOTP_DEFAULTS.period) params.set('period', String(totp.period))
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`
}

// The code for `nowMs`, plus how long it stays valid.
export async function generateTotp(totp, nowMs = Date.now()) {
  const algorithm = totp.algorithm || TOTP_DEFAULTS.algorithm
  const digits = totp.digits || TOTP_DEFAULTS.digits
  const period = totp.period || TOTP_DEFAULTS.period

  const seconds = Math.floor(nowMs / 1000)
  const counter = Math.floor(seconds / period)

  // 8-byte big-endian counter
  const msg = new Uint8Array(8)
  let c = counter
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff
    c = Math.floor(c / 256)
  }

  const key = await crypto.subtle.importKey(
    'raw',
    base32ToBytes(totp.secret),
    { name: 'HMAC', hash: ALGORITHMS[algorithm] },
    false,
    ['sign'],
  )
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))

  const offset = hmac[hmac.length - 1] & 0x0f
  const bin =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]
  const code = String(bin % 10 ** digits).padStart(digits, '0')

  return { code, counter, period, digits, secondsLeft: period - (seconds % period) }
}

// "123456" -> "123 456" (and "12345678" -> "1234 5678"): easier to read and
// to type from. Copying always uses the plain digits.
export function formatTotpCode(code) {
  const half = Math.ceil(code.length / 2)
  return `${code.slice(0, half)} ${code.slice(half)}`
}
