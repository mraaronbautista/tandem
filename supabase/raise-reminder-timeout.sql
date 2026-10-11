-- Gives the 5-minute reminder job 20 seconds to hear back from the function
-- instead of the default 5. Run once by hand in the Supabase SQL editor.
-- Idempotent: safe to re-run. No AI session applies this without Aaron saying
-- "run it".
--
-- Why: pg_net gives up waiting after 5 seconds. Now and then the function
-- takes a little longer (a cold start), and the log records a timeout even
-- though the function finishes on its own. Nothing is lost (the next run is
-- five minutes later and reminders have a 15-minute window), but it makes the
-- log look like a failure. This only changes how long the job WAITS.
--
-- The job's command contains the notification secret, so this edits it in
-- place with replace() and never reads, prints or retypes the secret.

select cron.alter_job(
  job_id := jobid,
  command := replace(
    command,
    $q$body := '{}'::jsonb$q$,
    $q$body := '{}'::jsonb, timeout_milliseconds := 20000$q$
  )
)
from cron.job
where jobname = 'notify-reminders-every-5-min'
  and command not like '%timeout_milliseconds%';

-- Read-only check (prints no secret). Expect: has_timeout = true.
select jobname, schedule, command like '%timeout_milliseconds := 20000%' as has_timeout
from cron.job
where jobname = 'notify-reminders-every-5-min';
