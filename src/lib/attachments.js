import { supabase } from './supabaseClient'

const BUCKET = 'task-attachments'

// Store a stable reference, never a publicly accessible URL.
export async function uploadCompletionAttachment(taskId, file) {
  const ext = file.name.split('.').pop().replace(/[^a-zA-Z0-9]/g, '') || 'bin'
  const path = `${taskId}-${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file)
  if (error) throw error
  return `storage://${BUCKET}/${path}`
}

export function attachmentPath(reference) {
  const prefix = `storage://${BUCKET}/`
  if (reference?.startsWith(prefix)) return reference.slice(prefix.length)
  // Existing task/comment/report JSON retains its old public URL. Resolve
  // only this project's bucket, then use authenticated download instead.
  const url = new URL(reference)
  if (url.origin !== new URL(import.meta.env.VITE_SUPABASE_URL).origin) {
    throw new Error('Unknown attachment source')
  }
  const legacy = `/storage/v1/object/public/${BUCKET}/`
  if (!url.pathname.startsWith(legacy)) throw new Error('Unknown attachment path')
  return decodeURIComponent(url.pathname.slice(legacy.length))
}

// Keyed by reference, not path — PrivateAttachment.jsx eagerly downloads
// on mount, so the same attachment rendered twice at once (e.g. a task's
// "View submission" and "Edit submission" modals) or remounted seconds
// apart (closing one, opening the other) would otherwise re-fetch the
// full file body every time. Evicted on failure so a transient error
// doesn't stick a permanent rejection in the cache.
const downloadCache = new Map()

export function downloadAttachment(reference) {
  if (!downloadCache.has(reference)) {
    const promise = supabase.storage
      .from(BUCKET)
      .download(attachmentPath(reference))
      .then(({ data, error }) => {
        if (error) throw error
        return data
      })
      .catch((err) => {
        downloadCache.delete(reference)
        throw err
      })
    downloadCache.set(reference, promise)
  }
  return downloadCache.get(reference)
}

// Whether an attachment's original filename looks like an image, to
// decide between rendering an <img> preview vs. a plain download link.
export function isImageAttachment(filename) {
  return /\.(png|jpe?g|gif|webp|svg|heic|heif|bmp)$/i.test(filename || '')
}
