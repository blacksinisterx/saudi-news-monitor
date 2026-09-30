-- Idempotent schema. Run with: npm run db:setup (or paste into Supabase SQL editor).
create table if not exists users (
  id serial primary key,
  email text unique,
  created_at timestamptz not null default now()
);
insert into users (email) values ('owner@local') on conflict do nothing;

create table if not exists sources (
  id text primary key,
  name text not null,
  type text not null check (type in ('rss','gdelt')),
  url text not null,
  role text not null check (role in ('official','wire','media','aggregator')),
  publisher text not null,                 -- independence key: two sources with same publisher count once
  saudi_native boolean not null default false, -- every item is Saudi-relevant (e.g. SPA)
  interval_sec int not null default 60,
  enabled boolean not null default true,
  etag text, last_modified text,
  last_attempt_at timestamptz, last_success_at timestamptz,
  consecutive_failures int not null default 0,
  last_error text,
  articles_total int not null default 0,
  is_test boolean not null default false
);

create table if not exists articles (
  id bigserial primary key,
  source_id text not null references sources(id) on delete cascade,
  url text not null unique,
  title text not null,
  snippet text not null default '',        -- <=300 chars of feed description only; no full text stored
  publisher text not null default '',     -- independence key (host), e.g. reuters.com
  role text not null default 'media',      -- official | wire | media (aggregators resolve to the real publisher)
  published_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  saudi_score int not null default 0,
  is_saudi boolean not null default false,
  event_id bigint
);
create index if not exists articles_event_idx on articles(event_id);
create index if not exists articles_pub_idx on articles(published_at desc);

create table if not exists events (
  id bigserial primary key,
  headline text not null,
  summary text not null default '',
  what_happened text not null default '',
  confirmed_facts jsonb not null default '[]',
  claims jsonb not null default '[]',
  unknowns jsonb not null default '[]',
  category text not null default 'general',
  location text not null default 'Saudi Arabia',
  importance text not null default 'NORMAL' check (importance in ('CRITICAL','HIGH','NORMAL','LOW')),
  verification text not null default 'UNCONFIRMED'
    check (verification in ('CONFIRMED','REPORTED','CLAIMED','UNCONFIRMED','CONFLICTING')),
  confidence text not null default 'low',
  source_count int not null default 1,
  ai_provider text not null default 'rules',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_test boolean not null default false
);
create index if not exists events_seen_idx on events(last_seen_at desc);
create index if not exists events_imp_idx on events(importance, last_seen_at desc);

create table if not exists event_sources (
  event_id bigint not null references events(id) on delete cascade,
  article_id bigint not null references articles(id) on delete cascade,
  source_id text not null references sources(id) on delete cascade,
  primary key (event_id, article_id)
);

create table if not exists push_subscriptions (
  id bigserial primary key,
  user_id int not null references users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  -- {level:'critical'|'high'|'all', categories:[] (empty = all), quiet:{enabled,start:'23:00',end:'07:00',tz:'Asia/Riyadh'}}
  prefs jsonb not null default '{"level":"high","categories":[],"quiet":{"enabled":false,"start":"23:00","end":"07:00","tz":"Asia/Riyadh"}}',
  failure_count int not null default 0,
  last_success_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id bigserial primary key,
  event_id bigint not null references events(id) on delete cascade,
  subscription_id bigint references push_subscriptions(id) on delete set null,
  stage text not null check (stage in ('initial','confirmed','conflict')),
  status text not null check (status in ('sent','failed','skipped')),
  error text,
  attempts int not null default 1,
  created_at timestamptz not null default now(),
  unique (event_id, subscription_id, stage)
);

create table if not exists locks (
  name text primary key,
  locked_until timestamptz not null
);

create table if not exists processing_logs (
  id bigserial primary key,
  ts timestamptz not null default now(),
  level text not null,
  stage text not null,
  source_id text,
  message text not null,
  meta jsonb
);
create index if not exists logs_ts_idx on processing_logs(ts desc);

-- Supabase exposes tables via its REST API to the anon key. We only use the direct Postgres
-- connection (service side), so lock everything down.
alter table users enable row level security;
alter table sources enable row level security;
alter table articles enable row level security;
alter table events enable row level security;
alter table event_sources enable row level security;
alter table push_subscriptions enable row level security;
alter table notifications enable row level security;
alter table processing_logs enable row level security;
alter table locks enable row level security;
