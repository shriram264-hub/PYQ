-- A function that does nothing but answer, so a daily scheduled request
-- (.github/workflows/keep-supabase-awake.yml) is real database activity. A
-- free-plan project pauses after 7 days without any, and while it is paused
-- nobody can sign in and nothing syncs. It reads no table and returns 1, so
-- letting signed-out visitors (anon) call it exposes nothing.

create function public.keep_alive() returns integer
  language sql
  stable
  as $$ select 1 $$;

-- Functions are executable by everyone by default; make the grant explicit.
revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;
