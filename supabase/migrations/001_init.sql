-- ============================================================
-- 001_init.sql
-- Core schema: projects + sources
--
-- projects.metadata stores the full editor state:
--   clips, audioLayers, overlayLayers, transcript, subtitle
--   appearance, output format, clip-level settings (crop/zoom/
--   transition/color-correction).
--
-- sources is a separate table so the server can resolve an
-- S3 key from a sourceId (the key embeds the original file
-- extension which is not derivable from the UUID alone).
-- ============================================================

-- ------------------------------------------------------------
-- projects
-- ------------------------------------------------------------
create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata   jsonb not null default '{}'::jsonb
);

-- Keep updated_at current automatically
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_updated_at
  before update on public.projects
  for each row execute procedure public.set_updated_at();

create index projects_user_id_idx on public.projects(user_id);
create index projects_updated_at_idx on public.projects(updated_at desc);

-- ------------------------------------------------------------
-- sources
-- One row per source video file.
-- s3_key  → used to generate presigned upload/download URLs.
-- name, duration → available without loading full metadata.
-- ------------------------------------------------------------
create table public.sources (
  id         uuid primary key,  -- same id as SourceVideo.id in the store
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  duration   float8 not null,
  s3_key     text not null,
  created_at timestamptz not null default now()
);

create index sources_project_id_idx on public.sources(project_id);
create index sources_user_id_idx    on public.sources(user_id);

-- ------------------------------------------------------------
-- Row-Level Security
-- ------------------------------------------------------------
alter table public.projects enable row level security;
alter table public.sources  enable row level security;

-- projects: full CRUD for the owning user only
create policy "projects: owner access"
  on public.projects
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- sources: full CRUD for the owning user only
create policy "sources: owner access"
  on public.sources
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
