-- ═══════════════════════════════════════════════════════════════
--  Visual Clinic 후기 시스템 — Supabase 스키마 (PART 1)
--  Supabase 대시보드 → SQL Editor 에 그대로 붙여넣고 RUN 하세요.
-- ═══════════════════════════════════════════════════════════════

-- ── 관리자 식별 ──────────────────────────────────────────────
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ── 후기 본체 ────────────────────────────────────────────────
create table if not exists public.reviews (
  id                uuid primary key default gen_random_uuid(),
  author_label      text not null,                       -- "김*미 · 14일 홈케어 수강생"
  body              jsonb not null,                      -- { "ko": 필수, "en": 선택, "ja": 선택 }
  rating            int  not null check (rating between 1 and 5),
  source            text not null check (source in ('course','visit')),
  user_id           uuid references auth.users(id) on delete set null,  -- 수강생 작성 시
  course_id         uuid,
  is_sponsored      boolean not null default false,      -- 대가 제공 → "체험단" 라벨
  consent_confirmed boolean not null,                    -- 게재 동의(false면 저장 불가)
  status            text not null default 'pending' check (status in ('pending','approved','rejected')),
  reject_reason     text,
  visible           boolean not null default false,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- 동의 없으면 저장 불가
  constraint reviews_consent_required check (consent_confirmed = true),
  -- ko 본문 필수
  constraint reviews_body_ko check (body ? 'ko' and length(trim(body->>'ko')) > 0)
);

create index if not exists reviews_public_idx on public.reviews (status, visible, sort_order);
create index if not exists reviews_user_idx   on public.reviews (user_id);

-- updated_at 자동 갱신
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists reviews_touch on public.reviews;
create trigger reviews_touch before update on public.reviews
  for each row execute function public.touch_updated_at();

-- ── 변경 이력 ────────────────────────────────────────────────
create table if not exists public.review_history (
  id         bigint generated always as identity primary key,
  review_id  uuid references public.reviews(id) on delete cascade,
  action     text not null,        -- created|updated|approved|rejected|visibility|reorder|deleted
  actor      uuid,
  detail     jsonb,
  created_at timestamptz not null default now()
);

-- ── 설정(금칙어 등) ─────────────────────────────────────────
create table if not exists public.review_settings (
  key   text primary key,
  value jsonb not null
);
insert into public.review_settings (key, value) values
  ('banned_words', '["치료","완치","교정됐","효과 보장","부작용 없"]'::jsonb),
  ('reject_reasons', '["욕설·비방","개인정보 노출","의료적 오인 표현","서비스와 무관"]'::jsonb)
on conflict (key) do nothing;

-- ═══════════════════════════════════════════════════════════════
--  RLS (Row Level Security)
-- ═══════════════════════════════════════════════════════════════
alter table public.reviews         enable row level security;
alter table public.review_history  enable row level security;
alter table public.review_settings enable row level security;
alter table public.admins          enable row level security;

-- reviews: 공개 읽기 = 승인 + 노출
drop policy if exists reviews_public_read on public.reviews;
create policy reviews_public_read on public.reviews
  for select using (status = 'approved' and visible = true);

-- reviews: 본인 작성분 읽기
drop policy if exists reviews_own_read on public.reviews;
create policy reviews_own_read on public.reviews
  for select using (user_id = auth.uid());

-- reviews: 수강생 본인 작성(항상 pending, 본인 user_id)
drop policy if exists reviews_own_insert on public.reviews;
create policy reviews_own_insert on public.reviews
  for insert with check (user_id = auth.uid() and status = 'pending');

-- reviews: 수강생 본인 수정(수정 시 재승인 대기 = pending)
drop policy if exists reviews_own_update on public.reviews;
create policy reviews_own_update on public.reviews
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and status = 'pending');

-- reviews: 관리자 전체 권한
drop policy if exists reviews_admin_all on public.reviews;
create policy reviews_admin_all on public.reviews
  for all using (public.is_admin()) with check (public.is_admin());

-- history: 관리자만
drop policy if exists history_admin_read on public.review_history;
create policy history_admin_read on public.review_history for select using (public.is_admin());
drop policy if exists history_admin_insert on public.review_history;
create policy history_admin_insert on public.review_history for insert with check (public.is_admin());

-- settings: 금칙어는 프론트 실시간 안내에 필요 → 공개 읽기, 수정은 관리자만
drop policy if exists settings_public_read on public.review_settings;
create policy settings_public_read on public.review_settings for select using (true);
drop policy if exists settings_admin_write on public.review_settings;
create policy settings_admin_write on public.review_settings for all
  using (public.is_admin()) with check (public.is_admin());

-- admins: 본인이 관리자인지 확인만
drop policy if exists admins_self_read on public.admins;
create policy admins_self_read on public.admins for select using (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
--  관리자 부트스트랩 (프로젝트 생성 + 관리자 계정 가입 후 1회)
--  아래 이메일을 대표님 관리자 계정 이메일로 바꿔 실행:
-- ═══════════════════════════════════════════════════════════════
-- insert into public.admins (user_id)
-- select id from auth.users where email = 'admin@visualkim.com'
-- on conflict do nothing;
