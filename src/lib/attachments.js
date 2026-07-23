import { supabase } from './supabaseClient'

const BUCKET = 'task-attachments'

// Whatever proof-of-completion makes sense for the task — a screenshot,
// but just as often a PDF, doc, or slide deck someone asked for. Uploads
// to the public task-attachments bucket and returns its public URL.
// Filename is namespaced by task id + timestamp so re-uploading for the
// same task doesn't collide with other tasks' (or its own prior) files.
export async function uploadCompletionAttachment(taskId, file) {
  const ext = file.name.split('.').pop()
  const path = `${taskId}-${Date.now()}.${ext}`

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
  if (error) throw error

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

// Whether an attachment's original filename looks like an image, to
// decide between rendering an <img> preview vs. a plain download link.
export function isImageAttachment(filename) {
  return /\.(png|jpe?g|gif|webp|svg|heic|heif|bmp)$/i.test(filename || '')
}
