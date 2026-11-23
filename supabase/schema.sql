-- Lytterom: PostgreSQL-skjema for Supabase
-- Kjør i Supabase SQL Editor. Lærere kobles til Supabase Auth (auth.users).
-- Elever trenger ingen konto: de leser fagrom via klassekode (offentlig lesetilgang).

create extension if not exists "pgcrypto";

create table if not exists public.teachers (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  subject text not null default '',
  class_label text not null default '',
  description text not null default '',
  code text not null unique check (code ~ '^[A-ZÆØÅ0-9-]{3,32}$'),
  accent_color text not null default '#C0563B',
  created_at timestamptz not null default now()
);

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  description text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.episodes (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
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

-- ---------- Row Level Security ----------
alter table public.teachers enable row level security;
alter table public.courses enable row level security;
alter table public.topics enable row level security;
alter table public.episodes enable row level security;

-- Lærere ser og endrer bare sin egen profil.
create policy "teacher reads self" on public.teachers for select using (auth.uid() = id);
create policy "teacher inserts self" on public.teachers for insert with check (auth.uid() = id);
create policy "teacher updates self" on public.teachers for update using (auth.uid() = id);

-- Fagrom, kapitler og episoder er offentlig lesbare (elever slår opp via klassekode).
create policy "public reads courses" on public.courses for select using (true);
create policy "public reads topics" on public.topics for select using (true);
create policy "public reads episodes" on public.episodes for select using (true);

-- Bare eieren kan opprette, endre og slette.
create policy "owner writes courses" on public.courses for all
  using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

create policy "owner writes topics" on public.topics for all
  using (exists (select 1 from public.courses c where c.id = course_id and c.teacher_id = auth.uid()))
  with check (exists (select 1 from public.courses c where c.id = course_id and c.teacher_id = auth.uid()));

create policy "owner writes episodes" on public.episodes for all
  using (exists (select 1 from public.courses c where c.id = course_id and c.teacher_id = auth.uid()))
  with check (exists (select 1 from public.courses c where c.id = course_id and c.teacher_id = auth.uid()));

-- Visning brukt av elevenes «Mine fag» uten å eksponere lærerens e-post.
create or replace view public.course_summaries as
select c.id, c.teacher_id, t.name as teacher_name, c.title, c.subject, c.class_label, c.description,
       c.code, c.accent_color, c.created_at,
       (select count(*) from public.episodes e where e.course_id = c.id) as episode_count,
       (select count(*) from public.topics tp where tp.course_id = c.id) as topic_count
from public.courses c join public.teachers t on t.id = c.teacher_id;

-- ---------- Lagring ----------
-- Opprett en offentlig bucket «episode-media» i Storage, og legg til disse reglene:
insert into storage.buckets (id, name, public) values ('episode-media', 'episode-media', true)
  on conflict (id) do nothing;

create policy "teachers upload own media" on storage.objects for insert to authenticated
  with check (bucket_id = 'episode-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "teachers delete own media" on storage.objects for delete to authenticated
  using (bucket_id = 'episode-media' and (storage.foldername(name))[1] = auth.uid()::text);
