-- Notification secret: ONE step that sets the same value everywhere the
-- database sends it. Run by hand in the Supabase SQL editor.
--
-- notify-task-events and notify-reminders are public web addresses that only
-- the database should call; they refuse any request that lacks the shared
-- secret. The database sends that secret from two places, and BOTH must hold
-- the same value as the function secret NOTIFY_SECRET:
--   1. the trigger function notify_task_event()  (task assigned / completed)
--   2. the scheduled job notify-reminders-every-5-min (reminders)
-- Setting them in separate steps is how they drifted apart once (the trigger
-- and the function held different values, and the job never got one, so every
-- call was refused with 401). This file sets both from a single value.
--
-- HOW (Terminal, one window, so the variable survives between lines):
--   S=$(openssl rand -hex 32)
--   supabase secrets set NOTIFY_SECRET=$S --project-ref qizvsymlntbukuhypkxh
--   echo -n $S | pbcopy
-- Then paste the clipboard between the quotes on the `s text :=` line below
-- (replace REPLACE-WITH-NOTIFY-SECRET, keep the quotes) and run this file.
-- The real value must never be committed; this file keeps a placeholder.
--
-- Safe to re-run (to rotate the secret, repeat all three steps). Only the
-- trigger function and the notify-reminders job are touched; the
-- ensure-upcoming-recurrences job is not.

do $outer$
declare
  s text := 'REPLACE-WITH-NOTIFY-SECRET';
begin
  execute format($fn$
    create or replace function notify_task_event() returns trigger as $body$
    begin
      perform net.http_post(
        url := 'https://qizvsymlntbukuhypkxh.supabase.co/functions/v1/notify-task-events',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', %L),
        body := jsonb_build_object(
          'type', tg_op,
          'table', 'tasks',
          'record', to_jsonb(new),
          'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end
        )
      );
      return new;
    end;
    $body$ language plpgsql security definer
  $fn$, s);

  perform cron.alter_job(
    job_id := (select jobid from cron.job where jobname = 'notify-reminders-every-5-min'),
    command := format($cmd$select net.http_post(
      url := 'https://qizvsymlntbukuhypkxh.supabase.co/functions/v1/notify-reminders',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', %L),
      body := '{}'::jsonb
    )$cmd$, s)
  );
end
$outer$;

-- Read-only check. Both fingerprints must be IDENTICAL to each other and to
-- the NOTIFY_SECRET digest printed by:
--   supabase secrets list --project-ref qizvsymlntbukuhypkxh
select encode(sha256(convert_to((regexp_match(prosrc, 'x-notify-secret'', ''([^'']+)'''))[1], 'utf8')), 'hex') as trigger_fingerprint,
       (select encode(sha256(convert_to((regexp_match(command, 'x-notify-secret'', ''([^'']+)'''))[1], 'utf8')), 'hex')
          from cron.job where jobname = 'notify-reminders-every-5-min') as reminder_job_fingerprint
from pg_proc where proname = 'notify_task_event';
