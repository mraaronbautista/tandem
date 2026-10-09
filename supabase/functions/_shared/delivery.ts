// Pure helpers (no imports, so they can be tested without Deno) for deciding
// whether a one-shot reminder was really delivered or should be tried again
// on the next run. Used by notify-reminders.
//
// Before this, a failed push was logged and the reminder was marked "sent"
// anyway, so a one-time reminder (lease ending, "still on your plate") was
// lost for good if the push service errored once.

export type PushResult = { delivered: number; retry: boolean }

// A temporary problem worth trying again: a dropped connection, a timeout,
// "too many requests", or the push service itself failing (5xx). Any other
// failure (a rejected key, a malformed subscription) will fail the same way
// next time, so it is NOT retried; retrying forever every five minutes would
// help nobody. A dead subscription (404/410) is pruned by the caller.
const NETWORK_CODES = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE', 'ECONNABORTED']

export function isTransientPushFailure(err: { statusCode?: number; code?: string } | null | undefined): boolean {
  if (!err) return false
  if (typeof err.statusCode === 'number') {
    return err.statusCode === 408 || err.statusCode === 429 || err.statusCode >= 500
  }
  return typeof err.code === 'string' && NETWORK_CODES.includes(err.code)
}

// Try again on the next run only when nobody was reached AND something
// temporary went wrong. If at least one person got it, the reminder counts
// as sent (a retry would just notify them twice).
export function shouldRetryReminder(results: PushResult[]): boolean {
  return results.some((r) => r.retry) && !results.some((r) => r.delivered > 0)
}
