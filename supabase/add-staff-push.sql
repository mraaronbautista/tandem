-- Push alerts for the house manager (a staff account). Run once by hand in the
-- Supabase SQL editor, after add-staff-issue-reports.sql. Idempotent: safe to
-- re-run. No AI session applies this without Aaron saying "run it".
--
-- Until now push subscriptions could only belong to a member. A subscription
-- may now belong to a staff account instead (exactly one owner). A staff
-- account never touches the table directly: it registers and removes its own
-- phone through two small functions. Registering a phone that is already
-- registered to someone else (the same phone, now signed in as him) moves it
-- to him, so one phone is never alerting two accounts.
--
-- Also adds the one-shot mark used when a member ticks off one of his issue
-- reports ("your report was marked done").

alter table public.push_subscriptions add column if not exists staff_id uuid references public.staff(id) on delete cascade;
alter table public.push_subscriptions alter column member_id drop not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_one_owner') then
    alter table public.push_subscriptions add constraint push_subscriptions_one_owner
      check ((member_id is null) <> (staff_id is null));
  end if;
end $$;
create index if not exists push_subscriptions_staff_idx on public.push_subscriptions (staff_id) where staff_id is not null;

alter table public.staff_issue_reports add column if not exists done_notified_at timestamptz;

create or replace function public.staff_register_push(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 2000
     or coalesce(length(p_p256dh), 0) not between 20 and 200 or coalesce(length(p_auth), 0) not between 10 and 100 then
    raise exception 'That phone could not be registered for alerts' using errcode = '22023';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (staff_id, endpoint, p256dh, auth) values (auth.uid(), p_endpoint, p_p256dh, p_auth);
  -- Keep at most five phones per account, newest first.
  delete from public.push_subscriptions
  where staff_id = auth.uid()
    and id not in (select id from public.push_subscriptions where staff_id = auth.uid() order by created_at desc, id limit 5);
end $$;
revoke all on function public.staff_register_push(text, text, text) from public, anon;
grant execute on function public.staff_register_push(text, text, text) to authenticated;

create or replace function public.staff_unregister_push(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and staff_id = auth.uid();
end $$;
revoke all on function public.staff_unregister_push(text) from public, anon;
grant execute on function public.staff_unregister_push(text) to authenticated;

-- Is this phone registered for him? (so the screen shows the real state)
create or replace function public.staff_push_registered(p_endpoint text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return exists (select 1 from public.push_subscriptions where endpoint = p_endpoint and staff_id = auth.uid());
end $$;
revoke all on function public.staff_push_registered(text) from public, anon;
grant execute on function public.staff_push_registered(text) to authenticated;

-- Read-only checks.
select column_name, is_nullable from information_schema.columns where table_name = 'push_subscriptions' and column_name in ('member_id', 'staff_id') order by 1;
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('staff_register_push', 'staff_unregister_push', 'staff_push_registered') order by 1;
