-- ============================================================
--  Lab RAG memory indexing schema
--  Additive schema for experiments on feature/rag-context-on-latest-main.
--  Run after supabase-schema.sql in the Supabase SQL editor.
-- ============================================================

-- ---------- Extensions ----------
-- pg_trgm helps Korean/English substring-ish retrieval before embeddings land.
-- vector is optional for now, but the nullable embedding column is ready for it.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists vector with schema extensions;

-- ---------- Tables ----------

create table if not exists public.meeting_memory_chunks (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references public.meetings(id) on delete cascade,
  source_type   text not null check (
    source_type in ('meeting', 'transcript', 'note', 'photo', 'board', 'extraction')
  ),
  source_id     uuid,
  chunk_index   integer not null default 0,
  memory_kind   text not null default 'raw_transcript' check (
    memory_kind in (
      'meeting_meta',
      'raw_transcript',
      'note',
      'board_capture',
      'decision',
      'todo',
      'open_question',
      'summary'
    )
  ),
  content       text not null check (length(trim(content)) > 0),
  speaker       text,
  start_seconds integer,
  end_seconds   integer,
  tags          text[] not null default '{}',
  metadata      jsonb not null default '{}'::jsonb,
  embedding     vector(1536),
  generated_by  text not null default 'manual',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.memory_extractions (
  id                 uuid primary key default gen_random_uuid(),
  meeting_id          uuid not null references public.meetings(id) on delete cascade,
  extraction_type     text not null check (
    extraction_type in ('decision', 'todo', 'open_question', 'board_asset', 'summary')
  ),
  title              text not null,
  body               text not null,
  reason             text,
  owner              text,
  status             text not null default 'open' check (
    status in ('open', 'in_progress', 'done', 'deferred', 'dropped', 'unknown')
  ),
  due_date           date,
  start_seconds      integer,
  end_seconds        integer,
  evidence_chunk_ids uuid[] not null default '{}',
  tags               text[] not null default '{}',
  confidence         real,
  metadata           jsonb not null default '{}'::jsonb,
  generated_by       text not null default 'manual',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.chat_sessions (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  mode        text check (mode in ('rag', 'web', 'plain')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references public.chat_sessions(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null check (length(trim(content)) > 0),
  mode        text check (mode in ('rag', 'web', 'plain')),
  sources     jsonb not null default '[]'::jsonb,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists public.meeting_chat_context_selections (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings(id) on delete cascade,
  chat_id     uuid not null references public.chat_sessions(id) on delete cascade,
  selected_at timestamptz not null default now(),
  unique (meeting_id, chat_id)
);

-- ---------- Indexes ----------

create index if not exists meeting_memory_chunks_meeting_id_idx
  on public.meeting_memory_chunks(meeting_id);

create index if not exists meeting_memory_chunks_source_idx
  on public.meeting_memory_chunks(source_type, source_id);

create index if not exists meeting_memory_chunks_kind_idx
  on public.meeting_memory_chunks(memory_kind);

create index if not exists meeting_memory_chunks_time_idx
  on public.meeting_memory_chunks(meeting_id, start_seconds, end_seconds);

create index if not exists meeting_memory_chunks_tags_idx
  on public.meeting_memory_chunks using gin(tags);

create index if not exists meeting_memory_chunks_fts_idx
  on public.meeting_memory_chunks
  using gin(to_tsvector('simple', content));

create index if not exists meeting_memory_chunks_trgm_idx
  on public.meeting_memory_chunks
  using gin(content gin_trgm_ops);

create index if not exists meeting_memory_chunks_embedding_idx
  on public.meeting_memory_chunks
  using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

create index if not exists memory_extractions_meeting_id_idx
  on public.memory_extractions(meeting_id);

create index if not exists memory_extractions_type_idx
  on public.memory_extractions(extraction_type);

create index if not exists memory_extractions_status_idx
  on public.memory_extractions(status);

create index if not exists memory_extractions_tags_idx
  on public.memory_extractions using gin(tags);

create index if not exists memory_extractions_fts_idx
  on public.memory_extractions
  using gin(to_tsvector('simple', title || ' ' || body || ' ' || coalesce(reason, '')));

create index if not exists chat_sessions_updated_at_idx
  on public.chat_sessions(updated_at desc);

create index if not exists chat_messages_chat_id_idx
  on public.chat_messages(chat_id, created_at);

create index if not exists meeting_chat_context_meeting_idx
  on public.meeting_chat_context_selections(meeting_id);

create index if not exists meeting_chat_context_chat_idx
  on public.meeting_chat_context_selections(chat_id);

-- ---------- Updated-at trigger ----------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists meeting_memory_chunks_set_updated_at on public.meeting_memory_chunks;
create trigger meeting_memory_chunks_set_updated_at
  before update on public.meeting_memory_chunks
  for each row execute function public.set_updated_at();

drop trigger if exists memory_extractions_set_updated_at on public.memory_extractions;
create trigger memory_extractions_set_updated_at
  before update on public.memory_extractions
  for each row execute function public.set_updated_at();

drop trigger if exists chat_sessions_set_updated_at on public.chat_sessions;
create trigger chat_sessions_set_updated_at
  before update on public.chat_sessions
  for each row execute function public.set_updated_at();

-- ---------- Text retrieval helper ----------
-- This is a database-side baseline before embedding search is wired.

create or replace function public.search_memory_chunks(
  query_text text,
  match_count integer default 8,
  project_filter text default null
)
returns table (
  id uuid,
  meeting_id uuid,
  meeting_title text,
  meeting_date date,
  project_tag text,
  source_type text,
  source_id uuid,
  memory_kind text,
  content text,
  speaker text,
  start_seconds integer,
  end_seconds integer,
  tags text[],
  metadata jsonb,
  lexical_rank real,
  similarity_rank real
)
language sql
stable
as $$
  select
    c.id,
    c.meeting_id,
    m.title as meeting_title,
    m.date as meeting_date,
    m.project_tag,
    c.source_type,
    c.source_id,
    c.memory_kind,
    c.content,
    c.speaker,
    c.start_seconds,
    c.end_seconds,
    c.tags,
    c.metadata,
    ts_rank_cd(to_tsvector('simple', c.content), plainto_tsquery('simple', query_text)) as lexical_rank,
    similarity(c.content, query_text) as similarity_rank
  from public.meeting_memory_chunks c
  join public.meetings m on m.id = c.meeting_id
  where length(trim(query_text)) > 0
    and (project_filter is null or m.project_tag = project_filter)
  order by
    greatest(
      ts_rank_cd(to_tsvector('simple', c.content), plainto_tsquery('simple', query_text)),
      similarity(c.content, query_text)
    ) desc,
    m.date desc nulls last,
    c.created_at desc
  limit greatest(1, least(match_count, 50));
$$;

-- ---------- Row Level Security ----------
-- Same hackathon posture as supabase-schema.sql. Lock this down before real use.

alter table public.meeting_memory_chunks enable row level security;
alter table public.memory_extractions    enable row level security;
alter table public.chat_sessions         enable row level security;
alter table public.chat_messages         enable row level security;
alter table public.meeting_chat_context_selections enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'meeting_memory_chunks',
    'memory_extractions',
    'chat_sessions',
    'chat_messages',
    'meeting_chat_context_selections'
  ] loop
    execute format('drop policy if exists "anon_all" on public.%I;', t);
    execute format(
      'create policy "anon_all" on public.%I for all to anon, authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;
