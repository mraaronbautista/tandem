-- Closes audit finding 3 (Oct 8 2026, low): generate_month_occurrences() runs
-- with the database owner's rights and had no caller check and no revoke, so
-- any signed-in user (or a signed-out visitor) who knew a recurring task's id
-- could call it directly through the API and generate that task's copies.
-- Run once by hand in the Supabase SQL editor. Idempotent. No AI session
-- applies this.
--
-- Safe: every legitimate caller is itself a security definer function or the
-- database's own job, which run as the owner and keep the right to call it:
-- the sync trigger on tasks (sync_current_month_recurrences), the member-
-- checked ensure_month_recurrences(), and the hourly pg_cron job
-- ensure_upcoming_recurrences(). The app never calls it directly.

revoke all on function public.generate_month_occurrences(uuid, date) from public, anon, authenticated;

-- Read-only check. Expect: owner_can_run = true; the other three = false.
select
  has_function_privilege('postgres', 'public.generate_month_occurrences(uuid, date)', 'execute') as owner_can_run,
  has_function_privilege('anon', 'public.generate_month_occurrences(uuid, date)', 'execute') as anon_can_run,
  has_function_privilege('authenticated', 'public.generate_month_occurrences(uuid, date)', 'execute') as signed_in_can_run,
  has_function_privilege('public', 'public.generate_month_occurrences(uuid, date)', 'execute') as public_can_run;
