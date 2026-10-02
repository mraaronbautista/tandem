// supabase.functions.invoke() reports any non-2xx reply as a generic
// FunctionsHttpError ("Edge Function returned a non-2xx status code") and
// leaves the function's own message — "Password must be at least 8
// characters", "Forbidden — admins only" — unread on error.context (the raw
// Response). The account functions deliberately return those specific,
// plain-text messages, but until now nobody read them, so the person saw
// only the generic line. This reads the body and rethrows it as the
// message; friendlyError() then rewords anything still technical.
export async function throwFunctionError(error) {
  let message = ''
  try {
    const body = await error?.context?.text?.()
    if (body) {
      try {
        const parsed = JSON.parse(body)
        message = parsed?.error || parsed?.message || ''
      } catch {
        message = body
      }
    }
  } catch {
    // Body already consumed or unreadable — fall through to the original.
  }
  throw message ? new Error(message) : error
}
