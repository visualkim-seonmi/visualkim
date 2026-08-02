-- ═══════════════════════════════════════════════════════════════
--  BEFORE & AFTER — 표 + 스토리지 버킷 + 정책
--  Supabase SQL Editor 에 붙여넣고 RUN (schema.sql 실행 이후에)
-- ═══════════════════════════════════════════════════════════════

-- 전·후 사례 표
create table if not exists public.before_after (
  id                uuid primary key default gen_random_uuid(),
  caption           jsonb,                       -- { ko, en, ja } 선택
  before_url        text not null,
  after_url         text not null,
  source            text,                        -- 'course' | 'visit' (선택)
  consent_confirmed boolean not null default false,  -- 게재 동의(필수)
  visible           boolean not null default false,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists ba_public_idx on public.before_after (visible, sort_order);

alter table public.before_after enable row level security;
drop policy if exists ba_public_read on public.before_after;
create policy ba_public_read on public.before_after for select using (visible = true);
drop policy if exists ba_admin_all on public.before_after;
create policy ba_admin_all on public.before_after for all
  using (public.is_admin()) with check (public.is_admin());

-- 사진 저장용 공개 스토리지 버킷 'cases'
insert into storage.buckets (id, name, public) values ('cases','cases',true)
on conflict (id) do nothing;

-- 스토리지 정책: 공개 읽기 / 업로드·삭제는 관리자만
drop policy if exists cases_read on storage.objects;
create policy cases_read on storage.objects for select using (bucket_id = 'cases');
drop policy if exists cases_admin_ins on storage.objects;
create policy cases_admin_ins on storage.objects for insert with check (bucket_id = 'cases' and public.is_admin());
drop policy if exists cases_admin_upd on storage.objects;
create policy cases_admin_upd on storage.objects for update using (bucket_id = 'cases' and public.is_admin());
drop policy if exists cases_admin_del on storage.objects;
create policy cases_admin_del on storage.objects for delete using (bucket_id = 'cases' and public.is_admin());
