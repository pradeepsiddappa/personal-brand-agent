-- =============================================================
-- Personal Brand Agent — Supabase Setup (single file)
-- =============================================================
-- Run this once in your Supabase project's SQL Editor.
-- Safe to re-run: every create/alter uses `if not exists`.
--
-- This file sets up EVERYTHING the dashboard needs:
--   • Enums + tables
--   • Indexes + views
--   • Row-level security policies (every user only sees their own rows)
--   • Realtime publications
--   • Updated-at triggers
--
-- It does NOT seed the 7 default agents — those are inserted
-- per-user on first login by the app itself (see
-- api/pa/agents/seed.js). You don't need to do anything.
-- =============================================================


-- ── ENUMS ────────────────────────────────────────────────────

do $$ begin
  create type draft_stage as enum (
    'writer','editor','messenger','publisher','done','rejected'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type draft_category as enum (
    'builder-proof','point-of-view','teaching'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type draft_confidence as enum ('strong','needs_review','weak');
exception when duplicate_object then null; end $$;

do $$ begin
  create type event_kind as enum (
    'signal','draft','review','sent','approved','rejected',
    'posted','run','insight','report'
  );
exception when duplicate_object then null; end $$;


-- ── 1. settings — per-user BYOK keys (encrypted) ─────────────

create table if not exists settings (
  user_id uuid primary key references auth.users on delete cascade,
  uber_goal text,
  brand_voice text,
  website_url text,                    -- e.g. https://yourdomain.com
  claude_key_enc text,
  twitter_client_id text,
  twitter_client_secret_enc text,
  twitter_access_token_enc text,
  twitter_refresh_token_enc text,
  twitter_expires_at timestamptz,
  twitter_user_id text,
  twitter_handle text,
  telegram_bot_token_enc text,
  telegram_chat_id text,
  linkedin_client_id text,
  linkedin_client_secret_enc text,
  linkedin_access_token_enc text,
  linkedin_expires_at timestamptz,
  linkedin_member_urn text,
  github_token_enc text,
  github_repo text,                    -- e.g. "your-github-user/your-site-repo"
  github_branch text,                  -- defaults to main
  promotions text,
  brand_accent_hex text,
  design_language text,
  reference_links text,
  tweet_templates text,
  image_font text default 'Inter',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);


-- ── 2. agents_config — user-editable agent definitions ───────

create table if not exists agents_config (
  user_id uuid not null references auth.users on delete cascade,
  id text not null,
  name text not null,
  role text not null,
  goal text,
  description text,
  prompt_template text,
  schedule text default 'manual',
  depends_on text[] default '{}',
  enabled boolean default true,
  order_index int default 0,
  config jsonb default '{}',
  paused_until timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, id)
);

create index if not exists agents_config_order on agents_config(user_id, order_index);


-- ── 3. signals — Scout writes, Writer reads ──────────────────

create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz default now(),
  source text not null,                -- 'twitter' | 'hackernews' | 'reddit' | 'devto'
  author text,
  url text,
  excerpt text not null,
  topics text[] default '{}',
  engagement jsonb,
  cluster_id uuid,
  noted boolean default false
);

create index if not exists signals_user_created on signals(user_id, created_at desc);
create index if not exists signals_topics       on signals using gin(topics);


-- ── 4. drafts — Writer creates, others update ────────────────

create table if not exists drafts (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  stage draft_stage default 'writer',
  category draft_category,
  text text not null,
  text_linkedin text,                  -- paragraph-form LinkedIn version
  source_signals uuid[] default '{}',
  source_urls text[],
  editor_notes jsonb,
  confidence draft_confidence,
  scheduled_at timestamptz,
  sent_at timestamptz,
  posted_at timestamptz,
  post_id text,
  post_url text,
  linkedin_url text,
  engagement jsonb,
  image_svg text,
  image_spec jsonb,
  image_url text,
  platforms text[] default array['twitter','linkedin']::text[],
  draft_type text default 'single',    -- 'single' | 'thread' | 'longpost'
  thread_parts text[],
  seed_text text
);

create index if not exists drafts_user_stage   on drafts(user_id, stage);
create index if not exists drafts_user_created on drafts(user_id, created_at desc);


-- ── 5. events — every agent logs actions (powers Timeline) ───

create table if not exists events (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz default now(),
  agent text not null,                 -- 'scout' | 'writer' | ... | 'human'
  kind event_kind not null,
  title text not null,
  detail text,
  tag text,
  ref_id text,
  meta jsonb
);

create index if not exists events_user_created on events(user_id, created_at desc);
create index if not exists events_user_agent   on events(user_id, agent, created_at desc);


-- ── 6. analyst_reports — weekly snapshots ────────────────────

create table if not exists analyst_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  week_start date not null,
  posted int,
  approved int,
  rejected int,
  drafted int,
  approval_rate numeric,
  total_engagement int,
  best_post_id text,
  heatmap jsonb,
  category_perf jsonb,
  voice_drift numeric[],
  trending_missed text[],
  recommendations jsonb,
  created_at timestamptz default now(),
  unique (user_id, week_start)
);


-- ── 7. seo_recommendations — items the SEO agent surfaces ────
-- Each row maps to one Telegram approval card. On Apply we commit
-- the (file, old, new) edit to the user's GitHub repo.

create table if not exists seo_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  page_url text,
  kind text,                           -- meta | alt | title | content | structure | links
  priority text default 'medium',      -- high | medium | low
  suggestion text not null,
  auto_applicable boolean default false,
  file_path text,
  old_content text,
  new_content text,
  status text default 'pending',       -- pending | applied | skipped | failed
  decided_at timestamptz,
  commit_sha text,
  error text,
  created_at timestamptz default now()
);

create index if not exists seo_rec_user_pending
  on seo_recommendations(user_id, status, created_at desc);


-- ── 8. voice_examples — tweets you like, used by Writer ──────
-- Populated when you forward a tweet or type a line to your
-- Telegram bot. Writer pulls the most recent 8 as voice anchors.

create table if not exists voice_examples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  text text not null,
  source text,                         -- 'telegram-fwd' | 'manual' | 'url'
  source_url text,
  note text,
  created_at timestamptz default now()
);

create index if not exists voice_examples_user_recent
  on voice_examples(user_id, created_at desc);


-- ── VIEWS ────────────────────────────────────────────────────

create or replace view v_pipeline as
  select * from drafts
  where stage in ('writer','editor','messenger','publisher')
  order by updated_at desc;

create or replace view v_recent_events as
  select * from events
  order by created_at desc
  limit 500;


-- ── ROW-LEVEL SECURITY ───────────────────────────────────────
-- Every user only sees and writes their own rows.

alter table settings            enable row level security;
alter table agents_config       enable row level security;
alter table signals             enable row level security;
alter table drafts              enable row level security;
alter table events              enable row level security;
alter table analyst_reports     enable row level security;
alter table seo_recommendations enable row level security;
alter table voice_examples      enable row level security;

drop policy if exists "owner_all" on settings;
create policy "owner_all" on settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner_all" on agents_config;
create policy "owner_all" on agents_config
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner_all" on signals;
create policy "owner_all" on signals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner_all" on drafts;
create policy "owner_all" on drafts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner_all" on events;
create policy "owner_all" on events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner_all" on analyst_reports;
create policy "owner_all" on analyst_reports
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner_all" on seo_recommendations;
create policy "owner_all" on seo_recommendations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner_all" on voice_examples;
create policy "owner_all" on voice_examples
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ── REALTIME ─────────────────────────────────────────────────
-- Enable realtime for the tables the dashboard subscribes to.

do $$ begin
  alter publication supabase_realtime add table events;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table drafts;
exception when duplicate_object then null; end $$;


-- ── UPDATED_AT TRIGGERS ──────────────────────────────────────

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_settings_updated on settings;
create trigger trg_settings_updated before update on settings
  for each row execute function touch_updated_at();

drop trigger if exists trg_agents_updated on agents_config;
create trigger trg_agents_updated before update on agents_config
  for each row execute function touch_updated_at();

drop trigger if exists trg_drafts_updated on drafts;
create trigger trg_drafts_updated before update on drafts
  for each row execute function touch_updated_at();


-- =============================================================
-- Done. Open the dashboard at /pa, sign in with your email,
-- and your 7 agents will be seeded automatically on first login.
-- =============================================================
