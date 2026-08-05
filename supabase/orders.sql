-- ═══════════════════════════════════════════════════════════════
--  Visual Clinic 주문/결제 — Supabase 스키마
--  Supabase 대시보드 → SQL Editor 에 그대로 붙여넣고 RUN 하세요.
--  (schema.sql 을 먼저 실행해야 합니다 — is_admin() / touch_updated_at() 재사용)
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  order_id       text not null unique,                -- 토스 orderId (vc_<상품id>_<시각>_<난수>)
  payment_key    text,                                -- 토스 paymentKey (승인 성공 시)
  product_id     text not null,                       -- 'visit-care' | 'course-14d'
  order_name     text not null,
  amount         int  not null check (amount >= 0),
  currency       text not null default 'KRW',
  status         text not null default 'pending'
                 check (status in ('pending','paid','failed','canceled','refunded')),
  method         text,                                -- 카드 / 간편결제 등
  user_id        uuid references auth.users(id) on delete set null,
  customer_email text,
  raw            jsonb,                               -- 토스 승인 응답 원본 보관
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists orders_user_idx    on public.orders (user_id, created_at desc);
create index if not exists orders_status_idx  on public.orders (status, created_at desc);
create index if not exists orders_product_idx on public.orders (product_id, created_at desc);

-- updated_at 자동 갱신 (schema.sql 의 touch_updated_at 재사용)
drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════
--  RLS — 주문은 공개 읽기가 절대 없어야 합니다
-- ═══════════════════════════════════════════════════════════════
alter table public.orders enable row level security;

-- 본인 주문만 조회 (마이페이지용)
drop policy if exists orders_own_read on public.orders;
create policy orders_own_read on public.orders
  for select using (user_id = auth.uid());

-- 관리자 전체 권한
drop policy if exists orders_admin_all on public.orders;
create policy orders_admin_all on public.orders
  for all using (public.is_admin()) with check (public.is_admin());

-- ⚠ insert / update 정책을 일부러 만들지 않습니다.
--   주문 생성·갱신은 서버(api/confirm-payment.js)가 service_role 키로만 수행합니다.
--   service_role 은 RLS 를 우회하므로 별도 정책이 필요 없고,
--   정책이 없으므로 anon/authenticated 는 주문을 위조할 수 없습니다.
