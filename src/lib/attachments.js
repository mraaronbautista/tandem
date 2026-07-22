import { supabase } from './supabaseClient'

const BUCKET = 'task-attachments'

// Uploads a completion screenshot/photo to the public task-attachments
// bucket and returns its public URL. Filename is namespaced by task id so
// re-uploading for the same task doesn't collide with other tasks' files.
export async function uploadCompletionImage(taskId, file) {
  const ext = file.name.split('.').pop()
  const path = `${taskId}-${Date.now()}.${ext}`

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
  if (error) throw error

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}
