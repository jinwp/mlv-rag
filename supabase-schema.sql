-- ============================================================
--  Lab RAG — Supabase schema
--  Run this in the Supabase SQL editor (Dashboard → SQL Editor).
--  Safe to re-run: uses IF NOT EXISTS / idempotent policies.
-- ============================================================

-- ---------- Tables ----------

create table if not exists public.meetings (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  date         date,
  participants text[] not null default '{}',
  project_tag  text,
  agenda       text,
  created_at   timestamptz not null default now()
);

create table if not exists public.photos (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      uuid not null references public.meetings(id) on delete cascade,
  storage_path    text not null,
  elapsed_seconds integer not null default 0,
  created_at      timestamptz not null default now()
);

create table if not exists public.notes (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      uuid not null references public.meetings(id) on delete cascade,
  content         text not null,
  elapsed_seconds integer not null default 0,
  created_at      timestamptz not null default now()
);

create table if not exists public.transcripts (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings(id) on delete cascade,
  full_text   text not null,
  audio_path  text,
  created_at  timestamptz not null default now()
);

create index if not exists photos_meeting_id_idx      on public.photos(meeting_id);
create index if not exists notes_meeting_id_idx       on public.notes(meeting_id);
create index if not exists transcripts_meeting_id_idx on public.transcripts(meeting_id);
create index if not exists meetings_date_idx          on public.meetings(date desc);

-- ---------- Row Level Security ----------
-- NOTE: hackathon setup — these policies allow the anon key to do everything.
-- Tighten (or add auth) before any real deployment.

alter table public.meetings    enable row level security;
alter table public.photos      enable row level security;
alter table public.notes       enable row level security;
alter table public.transcripts enable row level security;

do $$
declare t text;
begin
  foreach t in array array['meetings','photos','notes','transcripts'] loop
    execute format('drop policy if exists "anon_all" on public.%I;', t);
    execute format(
      'create policy "anon_all" on public.%I for all to anon, authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;

-- ---------- Storage bucket ----------
-- Public bucket so captured photos / audio can be served via getPublicUrl().

insert into storage.buckets (id, name, public)
values ('meeting-media', 'meeting-media', true)
on conflict (id) do update set public = true;

-- Storage policies (anon read + write into the meeting-media bucket)
drop policy if exists "meeting_media_read"   on storage.objects;
drop policy if exists "meeting_media_write"  on storage.objects;
drop policy if exists "meeting_media_update" on storage.objects;

create policy "meeting_media_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'meeting-media');

create policy "meeting_media_write" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'meeting-media');

create policy "meeting_media_update" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'meeting-media')
  with check (bucket_id = 'meeting-media');
