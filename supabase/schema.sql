-- Lytterom: PostgreSQL-skjema for Supabase.
-- Lim inn hele filen i Supabase → SQL Editor og trykk Run. Kan kjøres flere ganger.
--
-- Appen snakker med databasen bare fra serveren, med service role-nøkkelen, og sjekker
-- selv hvem som er logget inn. Row Level Security er derfor slått på uten regler:
-- da kan ingen lese eller endre noe med den offentlige anon-nøkkelen.

create table if not exists public.teachers (
  id text primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.courses (
  id text primary key,
  teacher_id text not null references public.teachers(id) on delete cascade,
  title text not null,
  subject text not null default '',
  class_label text not null default '',
  description text not null default '',
  code text not null unique,
  accent_color text not null default '#C0563B',
  notebook_url text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.topics (
  id text primary key,
  course_id text not null references public.courses(id) on delete cascade,
  title text not null,
  description text not null default '',
  notebook_url text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.courses add column if not exists notebook_url text not null default '';
alter table public.topics add column if not exists notebook_url text not null default '';

create table if not exists public.episodes (
  id text primary key,
  topic_id text not null references public.topics(id) on delete cascade,
  course_id text not null references public.courses(id) on delete cascade,
  title text not null,
  description text not null default '',
  study_notes text not null default '',
  media_type text not null check (media_type in ('audio', 'video', 'embed')),
  media_url text not null default '',
  embed_url text not null default '',
  duration_seconds int not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_courses_teacher on public.courses(teacher_id);
create index if not exists idx_topics_course on public.topics(course_id, sort_order);
create index if not exists idx_episodes_topic on public.episodes(topic_id, sort_order);
create index if not exists idx_episodes_course on public.episodes(course_id);

alter table public.teachers enable row level security;
alter table public.courses enable row level security;
alter table public.topics enable row level security;
alter table public.episodes enable row level security;

-- Fagrom med lærerens navn og antall kapitler og episoder. Viser ikke lærerens e-post.
-- security_invoker gjør at visningen følger tabellenes tilgangsregler.
create or replace view public.course_summaries with (security_invoker = true) as
select c.id, c.teacher_id, t.name as teacher_name, c.title, c.subject, c.class_label, c.description,
       c.code, c.accent_color, c.created_at,
       (select count(*) from public.episodes e where e.course_id = c.id)::int as episode_count,
       (select count(*) from public.topics tp where tp.course_id = c.id)::int as topic_count,
       c.notebook_url
from public.courses c join public.teachers t on t.id = c.teacher_id;

-- Lyd og video. Bucketen er offentlig for lesing, så elevene kan strømme filene.
-- Opplasting skjer bare med tidsbegrensede lenker fra serveren. Maks 50 MB per fil (gratisplanen).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('episode-media', 'episode-media', true, 52428800,
        array['audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/aac','audio/flac',
              'video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
