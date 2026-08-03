// Only needed by manual-notify — the other two Edge Functions are called
// server-to-server (Database Webhook / pg_cron), never from a browser, so
// they never hit CORS at all. This is the first client-invoked function.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Call at the top of the handler; returns a response to send immediately
// for a preflight OPTIONS request, or null if the request should proceed.
export function handleCors(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  return null
}
