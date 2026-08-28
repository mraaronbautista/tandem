import { supabase } from './supabaseClient'

const PBKDF2_ITERATIONS = 250000
const CANARY_TEXT = 'tandem-vault-ok'

// A fixed, short list rather than free-text — entries land in one of these
// intended buckets instead of drifting into typo'd near-duplicates ("Awa
// Rentalz" vs "Awa Rentals"). Extend this list directly if another folder
// is ever needed. `folder` itself lives inside the encrypted entry payload
// (see VaultEntryForm.jsx), not as its own database column — every entry
// is already decrypted client-side on every load (see VaultView.jsx's
// loadEntries), so grouping by a field inside that payload needs no schema
// change and doesn't leak which entries belong to which folder to anyone
// without the master password, unlike a plaintext column would.
export const VAULT_FOLDERS = ['Awa Rentalz', 'Azu Rentals']

function bytesToBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBytes(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function generateSalt() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)))
}

// PBKDF2-SHA256 (250k iterations, current OWASP guidance) turns the
// master password into an AES-GCM key — the master password itself never
// leaves the browser, only this derived key (held in memory only) and
// ciphertext ever touch Supabase.
async function deriveKey(masterPassword, saltBase64) {
  const encoder = new TextEncoder()
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(masterPassword), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: base64ToBytes(saltBase64), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// A fresh random IV per encryption (never reused with the same key, which
// would break AES-GCM's security guarantees) means the same object
// encrypts to different ciphertext every time — expected, not a bug.
export async function encryptJSON(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const ciphertextBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)), iv: bytesToBase64(iv) }
}

// GCM's built-in authentication tag means decrypting with the wrong key
// throws here rather than silently returning garbage — this is what lets
// unlockVault() double as "is this the right master password" with no
// separate check.
export async function decryptJSON(key, ciphertextBase64, ivBase64) {
  let plaintextBuffer
  try {
    plaintextBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(ivBase64) },
      key,
      base64ToBytes(ciphertextBase64),
    )
  } catch {
    throw new Error('Incorrect master password.')
  }
  return JSON.parse(new TextDecoder().decode(plaintextBuffer))
}

const PASSWORD_CHAR_CLASSES = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ', // no I/O — easy to misread
  'abcdefghijkmnpqrstuvwxyz', // no l
  '23456789', // no 0/1
  '!@#$%^&*()-_=+',
]

// Guarantees at least one char from each class by overwriting the first
// few positions, then fills the rest from the combined pool — simple, not
// a full shuffle, but good enough for a "Generate" button.
export function generateStrongPassword(length = 20) {
  const allChars = PASSWORD_CHAR_CLASSES.join('')
  const randomValues = crypto.getRandomValues(new Uint32Array(length))
  const chars = Array.from(randomValues, (v) => allChars[v % allChars.length])
  PASSWORD_CHAR_CLASSES.forEach((classChars, i) => {
    chars[i] = classChars[randomValues[i] % classChars.length]
  })
  return chars.join('')
}

export async function fetchVaultMeta() {
  const { data, error } = await supabase
    .from('vault_meta')
    .select('id, salt, canary_ciphertext, canary_iv')
    .maybeSingle()
  if (error) throw error
  return data
}

export async function setupVault(masterPassword) {
  const salt = generateSalt()
  const key = await deriveKey(masterPassword, salt)
  const { ciphertext, iv } = await encryptJSON(key, CANARY_TEXT)
  const { data, error } = await supabase
    .from('vault_meta')
    .insert({ salt, canary_ciphertext: ciphertext, canary_iv: iv })
    .select('id, salt, canary_ciphertext, canary_iv')
    .single()
  if (error) throw error
  return { meta: data, key }
}

export async function unlockVault(masterPassword, meta) {
  const key = await deriveKey(masterPassword, meta.salt)
  const canary = await decryptJSON(key, meta.canary_ciphertext, meta.canary_iv)
  if (canary !== CANARY_TEXT) throw new Error('Incorrect master password.')
  return key
}

// The forgot-password safety valve — there is no way to recover a
// forgotten master password by design, so this wipes everything and lets
// setup start over. Matches PostgREST's requirement that DELETE specify
// a filter; `.not('id', 'is', null)` matches every row since id is never
// null.
export async function resetVault() {
  const { error: entriesError } = await supabase.from('vault_entries').delete().not('id', 'is', null)
  if (entriesError) throw entriesError
  const { error: metaError } = await supabase.from('vault_meta').delete().not('id', 'is', null)
  if (metaError) throw metaError
}

export async function fetchVaultEntries() {
  const { data, error } = await supabase
    .from('vault_entries')
    .select('id, ciphertext, iv, created_by, created_at, updated_at')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function createVaultEntry({ ciphertext, iv, created_by }) {
  const { data, error } = await supabase
    .from('vault_entries')
    .insert({ ciphertext, iv, created_by })
    .select('id, ciphertext, iv, created_by, created_at, updated_at')
    .single()
  if (error) throw error
  return data
}

export async function updateVaultEntry(id, { ciphertext, iv }) {
  const { data, error } = await supabase
    .from('vault_entries')
    .update({ ciphertext, iv, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, ciphertext, iv, created_by, created_at, updated_at')
    .single()
  if (error) throw error
  return data
}

export async function deleteVaultEntry(id) {
  const { error } = await supabase.from('vault_entries').delete().eq('id', id)
  if (error) throw error
}
