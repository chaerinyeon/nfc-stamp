-- =============================================================================
-- 동네 한바퀴 NFC 쿠폰 도장 — Supabase 스키마 + 서버 로직
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전하도록 작성되어 있습니다(idempotent).
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- 1) 테이블
-- -----------------------------------------------------------------------------
create table if not exists stores (
  id text primary key,
  name text not null,
  category text not null default '기타',
  active boolean not null default true,
  admin_password_hash text,          -- 매장별 관리자 비밀번호(해시). null이면 매장 단독 로그인 비활성
  created_at timestamptz not null default now()
);

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone_last4 text not null,
  created_at timestamptz not null default now()
);

create table if not exists stamp_wallet (
  user_id uuid primary key references app_users(id) on delete cascade,
  current_stamp_count int not null default 0,
  goal_count int not null default 10,
  updated_at timestamptz not null default now()
);

create table if not exists stamp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  store_id text not null references stores(id),
  stamped_at timestamptz not null default now(),
  stamp_count_after int not null,
  status text not null default 'accumulated'
);
create index if not exists idx_stamp_events_user on stamp_events(user_id);
create index if not exists idx_stamp_events_store on stamp_events(store_id);

create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  title text not null,
  benefit text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'available',   -- available | used | expired
  used_at timestamptz,
  used_store_id text references stores(id)
);
create index if not exists idx_coupons_user on coupons(user_id);
create index if not exists idx_coupons_status on coupons(status);

-- 다중 쿠폰(적립 프로그램) — 하나의 프로그램 = 하나의 적립 트랙
create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  scope text not null default 'single_store' check (scope in ('single_store','alliance')),
  reset_on_tier boolean not null default false,   -- true면 단계 달성 시 초과분만 남기고 롤오버
  validity_days int not null default 30,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists program_stores (
  program_id uuid not null references programs(id) on delete cascade,
  store_id text not null references stores(id) on delete cascade,
  primary key (program_id, store_id)
);

create table if not exists program_tiers (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,
  threshold int not null check (threshold > 0),
  coupon_title text not null,
  benefit text not null,
  sort_order int not null default 0,
  unique (program_id, threshold)
);

create table if not exists user_programs (
  user_id uuid not null references app_users(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (user_id, program_id)
);

create table if not exists program_wallet (
  user_id uuid not null references app_users(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  current_count int not null default 0,
  issued_tier_thresholds int[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, program_id)
);
create index if not exists idx_program_wallet_user on program_wallet(user_id);

alter table coupons add column if not exists program_id uuid references programs(id);
alter table coupons add column if not exists tier_threshold int;
alter table coupons add column if not exists source_store_id text references stores(id);
alter table stamp_events add column if not exists program_id uuid references programs(id);

create table if not exists app_config (
  id int primary key default 1,
  goal_count int not null default 10,
  cooldown_seconds int not null default 30,
  coupon_validity_days int not null default 30,
  master_password_hash text not null,
  check (id = 1)
);

-- -----------------------------------------------------------------------------
-- 2) 초기 데이터 (이미 있으면 건너뜀)
-- -----------------------------------------------------------------------------
insert into app_config (id, goal_count, cooldown_seconds, coupon_validity_days, master_password_hash)
values (1, 10, 30, 30, crypt('1234', gen_salt('bf')))
on conflict (id) do nothing;

insert into stores (id, name, category, active) values
  ('store_001', '성수 카페', '카페', true),
  ('store_002', '동네 베이커리', '베이커리', true),
  ('store_003', '한바퀴 식당', '음식점', true)
on conflict (id) do nothing;

-- 기본 적립 프로그램 3종 (고정 UUID로 재실행해도 중복 생성되지 않음)
insert into programs (id, name, description, scope, reset_on_tier, validity_days, active) values
  ('00000000-0000-0000-0000-000000000001', '성수 카페 단골적립', '성수 카페 전용 적립 프로그램', 'single_store', false, 30, true),
  ('00000000-0000-0000-0000-000000000002', '동네 한바퀴 공동적립', '제휴 매장 어디서나 함께 모으는 공동 적립', 'alliance', false, 30, true),
  ('00000000-0000-0000-0000-000000000003', '동네 베이커리 스탬프', '동네 베이커리 전용 적립 프로그램', 'single_store', false, 30, true)
on conflict (id) do nothing;

insert into program_stores (program_id, store_id) values
  ('00000000-0000-0000-0000-000000000001', 'store_001'),
  ('00000000-0000-0000-0000-000000000002', 'store_001'),
  ('00000000-0000-0000-0000-000000000002', 'store_002'),
  ('00000000-0000-0000-0000-000000000002', 'store_003'),
  ('00000000-0000-0000-0000-000000000003', 'store_002')
on conflict do nothing;

insert into program_tiers (program_id, threshold, coupon_title, benefit, sort_order) values
  ('00000000-0000-0000-0000-000000000001', 10, '성수 카페 10% 할인 쿠폰', '전 메뉴 10% 할인', 1),
  ('00000000-0000-0000-0000-000000000001', 20, '성수 카페 10,000원 할인 쿠폰', '10,000원 할인', 2),
  ('00000000-0000-0000-0000-000000000002', 10, '동네 한바퀴 1,000원 할인 쿠폰', '1,000원 할인', 1),
  ('00000000-0000-0000-0000-000000000003', 10, '동네 베이커리 무료 음료 쿠폰', '음료 1잔 무료', 1)
on conflict (program_id, threshold) do nothing;

-- -----------------------------------------------------------------------------
-- 3) RLS — 직접 테이블 쓰기는 전부 차단, 읽기만 공개. 모든 변경은 아래 함수(RPC)로만.
-- -----------------------------------------------------------------------------
alter table stores enable row level security;
alter table app_users enable row level security;
alter table stamp_wallet enable row level security;
alter table stamp_events enable row level security;
alter table coupons enable row level security;
alter table app_config enable row level security;
alter table programs enable row level security;
alter table program_stores enable row level security;
alter table program_tiers enable row level security;
alter table user_programs enable row level security;
alter table program_wallet enable row level security;

drop policy if exists stores_select on stores;
drop policy if exists app_users_select on app_users;
drop policy if exists stamp_wallet_select on stamp_wallet;
drop policy if exists stamp_events_select on stamp_events;
drop policy if exists coupons_select on coupons;
drop policy if exists app_config_select on app_config;
drop policy if exists programs_select on programs;
drop policy if exists program_stores_select on program_stores;
drop policy if exists program_tiers_select on program_tiers;
drop policy if exists user_programs_select on user_programs;
drop policy if exists program_wallet_select on program_wallet;

create policy stores_select on stores for select using (true);
create policy app_users_select on app_users for select using (true);
create policy programs_select on programs for select using (true);
create policy program_stores_select on program_stores for select using (true);
create policy program_tiers_select on program_tiers for select using (true);
create policy user_programs_select on user_programs for select using (true);
create policy program_wallet_select on program_wallet for select using (true);
create policy stamp_wallet_select on stamp_wallet for select using (true);
create policy stamp_events_select on stamp_events for select using (true);
create policy coupons_select on coupons for select using (true);
create policy app_config_select on app_config for select using (true);

revoke insert, update, delete on stores, app_users, stamp_wallet, stamp_events, coupons, app_config,
  programs, program_stores, program_tiers, user_programs, program_wallet
  from anon, authenticated;
grant select on stores, app_users, stamp_wallet, stamp_events, coupons, app_config,
  programs, program_stores, program_tiers, user_programs, program_wallet to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) 내부 헬퍼 (직접 호출 권한 부여 안 함 — 다른 함수 내부에서만 사용)
-- -----------------------------------------------------------------------------
create or replace function _verify_store_or_master(p_store_id text, p_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare v_store stores; v_cfg app_config;
begin
  select * into v_cfg from app_config where id = 1;
  if v_cfg.master_password_hash is not null
     and crypt(coalesce(p_password, ''), v_cfg.master_password_hash) = v_cfg.master_password_hash then
    return true;
  end if;
  select * into v_store from stores where id = p_store_id;
  if found and v_store.admin_password_hash is not null
     and crypt(coalesce(p_password, ''), v_store.admin_password_hash) = v_store.admin_password_hash then
    return true;
  end if;
  return false;
end; $$;

-- -----------------------------------------------------------------------------
-- 5) 사용자 공개 API (고객 화면에서 호출)
-- -----------------------------------------------------------------------------
create or replace function app_create_user(p_name text, p_phone_last4 text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_phone text := regexp_replace(coalesce(p_phone_last4, ''), '\D', '', 'g');
  v_user app_users;
  v_goal int;
begin
  if v_name = '' then
    return jsonb_build_object('ok', false, 'message', '이름(또는 닉네임)을 입력해 주세요.');
  end if;
  v_phone := right(v_phone, 4);
  if length(v_phone) <> 4 then
    return jsonb_build_object('ok', false, 'message', '휴대폰 번호 뒤 4자리를 정확히 입력해 주세요.');
  end if;
  select goal_count into v_goal from app_config where id = 1;
  insert into app_users(name, phone_last4) values (v_name, v_phone) returning * into v_user;
  insert into stamp_wallet(user_id, current_stamp_count, goal_count) values (v_user.id, 0, coalesce(v_goal, 10));
  return jsonb_build_object('ok', true, 'user', to_jsonb(v_user));
end; $$;
grant execute on function app_create_user(text, text) to anon, authenticated;

create or replace function app_add_stamp(p_user_id uuid, p_store_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user app_users;
  v_store stores;
  v_cfg app_config;
  v_prog record;
  v_wallet program_wallet;
  v_last_event stamp_events;
  v_elapsed_ms bigint;
  v_wait_seconds int;
  v_event stamp_events;
  v_tier record;
  v_coupon coupons;
  v_results jsonb := '[]'::jsonb;
  v_any_program boolean := false;
  v_any_success boolean := false;
  v_program_result jsonb;
  v_issued_this jsonb;
  v_highest_issued int;
  v_min_wait int := null;
begin
  select * into v_user from app_users where id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NO_USER', 'message', '먼저 사용자 등록을 해주세요.');
  end if;

  select * into v_store from stores where id = p_store_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NO_STORE', 'message', '등록되지 않은 매장입니다.');
  end if;
  if not v_store.active then
    return jsonb_build_object('ok', false, 'code', 'INACTIVE_STORE', 'message', '현재 운영이 중지된 매장입니다.');
  end if;

  select * into v_cfg from app_config where id = 1;

  for v_prog in
    select p.* from programs p
    join program_stores ps on ps.program_id = p.id
    join user_programs up on up.program_id = p.id and up.user_id = p_user_id
    where ps.store_id = p_store_id and p.active = true
  loop
    v_any_program := true;

    -- 쿨다운: (사용자 + 매장 + 프로그램) 기준
    select * into v_last_event from stamp_events
      where user_id = p_user_id and store_id = p_store_id and program_id = v_prog.id
      order by stamped_at desc limit 1;
    if found and v_cfg.cooldown_seconds > 0 then
      v_elapsed_ms := extract(epoch from (now() - v_last_event.stamped_at)) * 1000;
      if v_elapsed_ms < v_cfg.cooldown_seconds * 1000 then
        v_wait_seconds := ceil((v_cfg.cooldown_seconds * 1000 - v_elapsed_ms) / 1000.0);
        if v_min_wait is null or v_wait_seconds < v_min_wait then v_min_wait := v_wait_seconds; end if;
        continue;
      end if;
    end if;

    select * into v_wallet from program_wallet where user_id = p_user_id and program_id = v_prog.id for update;
    if not found then
      insert into program_wallet(user_id, program_id, current_count, issued_tier_thresholds)
        values (p_user_id, v_prog.id, 0, '{}') returning * into v_wallet;
    end if;

    update program_wallet set current_count = current_count + 1, updated_at = now()
      where user_id = p_user_id and program_id = v_prog.id returning * into v_wallet;

    insert into stamp_events(user_id, store_id, stamped_at, stamp_count_after, status, program_id)
      values (p_user_id, p_store_id, now(), v_wallet.current_count, 'accumulated', v_prog.id)
      returning * into v_event;

    v_issued_this := null;
    v_highest_issued := null;

    for v_tier in
      select * from program_tiers
        where program_id = v_prog.id and threshold <= v_wallet.current_count
          and not (threshold = any(v_wallet.issued_tier_thresholds))
        order by threshold asc
    loop
      insert into coupons(user_id, title, benefit, issued_at, expires_at, status, program_id, tier_threshold, source_store_id)
        values (p_user_id, v_tier.coupon_title, v_tier.benefit, now(),
                now() + (v_prog.validity_days || ' days')::interval, 'available',
                v_prog.id, v_tier.threshold, p_store_id)
        returning * into v_coupon;
      update program_wallet set issued_tier_thresholds = array_append(issued_tier_thresholds, v_tier.threshold)
        where user_id = p_user_id and program_id = v_prog.id returning * into v_wallet;
      v_highest_issued := v_tier.threshold;
      v_issued_this := to_jsonb(v_coupon);
    end loop;

    if v_prog.reset_on_tier and v_highest_issued is not null then
      update program_wallet set current_count = greatest(current_count - v_highest_issued, 0), updated_at = now()
        where user_id = p_user_id and program_id = v_prog.id returning * into v_wallet;
    end if;

    v_any_success := true;
    v_program_result := jsonb_build_object(
      'programId', v_prog.id, 'programName', v_prog.name,
      'currentCount', v_wallet.current_count, 'coupon', v_issued_this
    );
    v_results := v_results || jsonb_build_array(v_program_result);
  end loop;

  if not v_any_program then
    return jsonb_build_object('ok', false, 'code', 'NO_PROGRAM',
      'message', '이 매장에서 적립 가능한 참여 프로그램이 없어요. 먼저 프로그램에 참여해 주세요.');
  end if;

  if not v_any_success then
    return jsonb_build_object('ok', false, 'code', 'COOLDOWN', 'waitSeconds', v_min_wait,
      'message', '방금 적립하셨어요. ' || v_min_wait || '초 후 다시 시도해 주세요.');
  end if;

  return jsonb_build_object('ok', true, 'code', 'STAMPED', 'store', to_jsonb(v_store), 'results', v_results);
end; $$;
grant execute on function app_add_stamp(uuid, text) to anon, authenticated;

create or replace function app_join_program(p_user_id uuid, p_program_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_prog programs;
begin
  if not exists (select 1 from app_users where id = p_user_id) then
    return jsonb_build_object('ok', false, 'message', '먼저 사용자 등록을 해주세요.');
  end if;
  select * into v_prog from programs where id = p_program_id;
  if not found or not v_prog.active then
    return jsonb_build_object('ok', false, 'message', '참여할 수 없는 프로그램입니다.');
  end if;
  insert into user_programs(user_id, program_id) values (p_user_id, p_program_id)
    on conflict (user_id, program_id) do nothing;
  insert into program_wallet(user_id, program_id, current_count, issued_tier_thresholds)
    values (p_user_id, p_program_id, 0, '{}')
    on conflict (user_id, program_id) do nothing;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function app_join_program(uuid, uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6) 관리자 API — 비밀번호 검증은 항상 서버(이 함수들)에서만 수행
-- -----------------------------------------------------------------------------
create or replace function admin_login_master(p_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare v_cfg app_config;
begin
  select * into v_cfg from app_config where id = 1;
  return v_cfg.master_password_hash is not null
    and crypt(coalesce(p_password, ''), v_cfg.master_password_hash) = v_cfg.master_password_hash;
end; $$;
grant execute on function admin_login_master(text) to anon, authenticated;

create or replace function admin_login_store(p_store_id text, p_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare v_store stores;
begin
  select * into v_store from stores where id = p_store_id;
  return found and v_store.admin_password_hash is not null
    and crypt(coalesce(p_password, ''), v_store.admin_password_hash) = v_store.admin_password_hash;
end; $$;
grant execute on function admin_login_store(text, text) to anon, authenticated;

create or replace function admin_create_store(p_master_password text, p_id text, p_name text, p_category text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_id text; v_store stores;
begin
  if not admin_login_master(p_master_password) then
    return jsonb_build_object('ok', false, 'message', '마스터 비밀번호가 올바르지 않습니다.');
  end if;
  if p_name is null or trim(p_name) = '' then
    return jsonb_build_object('ok', false, 'message', '매장명을 입력해 주세요.');
  end if;
  v_id := coalesce(nullif(trim(p_id), ''), 'store_' || substr(md5(random()::text), 1, 8));
  if exists (select 1 from stores where id = v_id) then
    return jsonb_build_object('ok', false, 'message', '이미 존재하는 매장 ID입니다.');
  end if;
  insert into stores(id, name, category, active)
    values (v_id, trim(p_name), coalesce(nullif(trim(p_category), ''), '기타'), true)
    returning * into v_store;
  return jsonb_build_object('ok', true, 'store', to_jsonb(v_store));
end; $$;
grant execute on function admin_create_store(text, text, text, text) to anon, authenticated;

create or replace function admin_update_store_info(p_store_id text, p_password text, p_name text, p_category text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if not _verify_store_or_master(p_store_id, p_password) then return false; end if;
  update stores set
    name = coalesce(nullif(trim(p_name), ''), name),
    category = coalesce(nullif(trim(p_category), ''), category)
    where id = p_store_id;
  return true;
end; $$;
grant execute on function admin_update_store_info(text, text, text, text) to anon, authenticated;

create or replace function admin_set_store_active(p_store_id text, p_password text, p_active boolean)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if not _verify_store_or_master(p_store_id, p_password) then return false; end if;
  update stores set active = p_active where id = p_store_id;
  return true;
end; $$;
grant execute on function admin_set_store_active(text, text, boolean) to anon, authenticated;

create or replace function admin_set_store_password(p_store_id text, p_password text, p_new_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if not _verify_store_or_master(p_store_id, p_password) then return false; end if;
  if p_new_password is null or length(p_new_password) < 4 then
    raise exception '비밀번호는 4자 이상이어야 합니다.';
  end if;
  update stores set admin_password_hash = crypt(p_new_password, gen_salt('bf')) where id = p_store_id;
  return true;
end; $$;
grant execute on function admin_set_store_password(text, text, text) to anon, authenticated;

create or replace function admin_change_master_password(p_old_password text, p_new_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if not admin_login_master(p_old_password) then return false; end if;
  if p_new_password is null or length(p_new_password) < 4 then
    raise exception '비밀번호는 4자 이상이어야 합니다.';
  end if;
  update app_config set master_password_hash = crypt(p_new_password, gen_salt('bf')) where id = 1;
  return true;
end; $$;
grant execute on function admin_change_master_password(text, text) to anon, authenticated;

create or replace function admin_use_coupon(p_coupon_id uuid, p_store_id text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_coupon coupons;
begin
  if not _verify_store_or_master(p_store_id, p_password) then
    return jsonb_build_object('ok', false, 'message', '비밀번호가 올바르지 않습니다.');
  end if;
  select * into v_coupon from coupons where id = p_coupon_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', '쿠폰을 찾을 수 없습니다.');
  end if;
  if v_coupon.status = 'used' then
    return jsonb_build_object('ok', false, 'message', '이미 사용 완료된 쿠폰입니다.');
  end if;
  if v_coupon.status = 'expired' or (v_coupon.expires_at is not null and v_coupon.expires_at < now()) then
    update coupons set status = 'expired' where id = p_coupon_id;
    return jsonb_build_object('ok', false, 'message', '유효기간이 지난 쿠폰은 사용 처리할 수 없습니다.');
  end if;
  update coupons set status = 'used', used_at = now(), used_store_id = p_store_id
    where id = p_coupon_id returning * into v_coupon;
  return jsonb_build_object('ok', true, 'coupon', to_jsonb(v_coupon));
end; $$;
grant execute on function admin_use_coupon(uuid, text, text) to anon, authenticated;

create or replace function admin_update_config(p_master_password text, p_goal_count int, p_cooldown_seconds int, p_coupon_validity_days int)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_cfg app_config;
begin
  if not admin_login_master(p_master_password) then
    return jsonb_build_object('ok', false, 'message', '마스터 비밀번호가 올바르지 않습니다.');
  end if;
  update app_config set
    goal_count = greatest(coalesce(p_goal_count, goal_count), 1),
    cooldown_seconds = greatest(coalesce(p_cooldown_seconds, cooldown_seconds), 0),
    coupon_validity_days = greatest(coalesce(p_coupon_validity_days, coupon_validity_days), 1)
    where id = 1 returning * into v_cfg;
  return jsonb_build_object('ok', true, 'config', to_jsonb(v_cfg));
end; $$;
grant execute on function admin_update_config(text, int, int, int) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6-1) 적립 프로그램(캠페인) 관리 — 총괄 관리자 전용
-- -----------------------------------------------------------------------------
create or replace function admin_create_program(
  p_master_password text, p_name text, p_description text, p_scope text,
  p_store_ids text[], p_tiers jsonb, p_validity_days int, p_reset_on_tier boolean
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_prog programs; v_sid text; v_tier jsonb; v_sort int := 0;
begin
  if not admin_login_master(p_master_password) then
    return jsonb_build_object('ok', false, 'message', '마스터 비밀번호가 올바르지 않습니다.');
  end if;
  if p_name is null or trim(p_name) = '' then
    return jsonb_build_object('ok', false, 'message', '프로그램명을 입력해 주세요.');
  end if;
  if p_scope not in ('single_store', 'alliance') then
    return jsonb_build_object('ok', false, 'message', '잘못된 scope 값입니다.');
  end if;
  if p_store_ids is null or array_length(p_store_ids, 1) is null then
    return jsonb_build_object('ok', false, 'message', '대상 매장을 최소 1곳 선택해 주세요.');
  end if;
  if p_tiers is null or jsonb_array_length(p_tiers) = 0 then
    return jsonb_build_object('ok', false, 'message', '단계(티어)를 최소 1개 추가해 주세요.');
  end if;

  insert into programs(name, description, scope, reset_on_tier, validity_days, active)
    values (trim(p_name), coalesce(p_description, ''), p_scope, coalesce(p_reset_on_tier, false),
            greatest(coalesce(p_validity_days, 30), 1), true)
    returning * into v_prog;

  foreach v_sid in array p_store_ids loop
    if exists (select 1 from stores where id = v_sid) then
      insert into program_stores(program_id, store_id) values (v_prog.id, v_sid) on conflict do nothing;
    end if;
  end loop;

  for v_tier in select * from jsonb_array_elements(p_tiers) loop
    v_sort := v_sort + 1;
    insert into program_tiers(program_id, threshold, coupon_title, benefit, sort_order)
      values (v_prog.id, (v_tier->>'threshold')::int, v_tier->>'couponTitle', v_tier->>'benefit', v_sort);
  end loop;

  return jsonb_build_object('ok', true, 'programId', v_prog.id);
end; $$;
grant execute on function admin_create_program(text, text, text, text, text[], jsonb, int, boolean) to anon, authenticated;

create or replace function admin_update_program(
  p_master_password text, p_program_id uuid, p_name text, p_description text, p_scope text,
  p_store_ids text[], p_tiers jsonb, p_validity_days int, p_reset_on_tier boolean, p_active boolean
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_sid text; v_tier jsonb; v_sort int := 0;
begin
  if not admin_login_master(p_master_password) then
    return jsonb_build_object('ok', false, 'message', '마스터 비밀번호가 올바르지 않습니다.');
  end if;
  if not exists (select 1 from programs where id = p_program_id) then
    return jsonb_build_object('ok', false, 'message', '프로그램을 찾을 수 없습니다.');
  end if;

  update programs set
    name = coalesce(nullif(trim(p_name), ''), name),
    description = coalesce(p_description, description),
    scope = coalesce(p_scope, scope),
    reset_on_tier = coalesce(p_reset_on_tier, reset_on_tier),
    validity_days = greatest(coalesce(p_validity_days, validity_days), 1),
    active = coalesce(p_active, active)
    where id = p_program_id;

  if p_store_ids is not null then
    delete from program_stores where program_id = p_program_id;
    foreach v_sid in array p_store_ids loop
      if exists (select 1 from stores where id = v_sid) then
        insert into program_stores(program_id, store_id) values (p_program_id, v_sid) on conflict do nothing;
      end if;
    end loop;
  end if;

  if p_tiers is not null then
    delete from program_tiers where program_id = p_program_id;
    for v_tier in select * from jsonb_array_elements(p_tiers) loop
      v_sort := v_sort + 1;
      insert into program_tiers(program_id, threshold, coupon_title, benefit, sort_order)
        values (p_program_id, (v_tier->>'threshold')::int, v_tier->>'couponTitle', v_tier->>'benefit', v_sort);
    end loop;
  end if;

  return jsonb_build_object('ok', true);
end; $$;
grant execute on function admin_update_program(text, uuid, text, text, text, text[], jsonb, int, boolean, boolean) to anon, authenticated;

create or replace function admin_set_program_active(p_program_id uuid, p_master_password text, p_active boolean)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if not admin_login_master(p_master_password) then return false; end if;
  update programs set active = p_active where id = p_program_id;
  return true;
end; $$;
grant execute on function admin_set_program_active(uuid, text, boolean) to anon, authenticated;

create or replace function admin_reset_test_data(p_master_password text, p_keep_stores boolean default true)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if not admin_login_master(p_master_password) then return false; end if;
  delete from coupons;
  delete from stamp_events;
  delete from program_wallet;
  delete from user_programs;
  delete from stamp_wallet;
  delete from app_users;
  if not p_keep_stores then
    delete from program_stores;
    delete from program_tiers;
    delete from programs;
    delete from stores;
    insert into stores(id, name, category, active) values
      ('store_001', '성수 카페', '카페', true),
      ('store_002', '동네 베이커리', '베이커리', true),
      ('store_003', '한바퀴 식당', '음식점', true);
    insert into programs (id, name, description, scope, reset_on_tier, validity_days, active) values
      ('00000000-0000-0000-0000-000000000001', '성수 카페 단골적립', '성수 카페 전용 적립 프로그램', 'single_store', false, 30, true),
      ('00000000-0000-0000-0000-000000000002', '동네 한바퀴 공동적립', '제휴 매장 어디서나 함께 모으는 공동 적립', 'alliance', false, 30, true),
      ('00000000-0000-0000-0000-000000000003', '동네 베이커리 스탬프', '동네 베이커리 전용 적립 프로그램', 'single_store', false, 30, true);
    insert into program_stores (program_id, store_id) values
      ('00000000-0000-0000-0000-000000000001', 'store_001'),
      ('00000000-0000-0000-0000-000000000002', 'store_001'),
      ('00000000-0000-0000-0000-000000000002', 'store_002'),
      ('00000000-0000-0000-0000-000000000002', 'store_003'),
      ('00000000-0000-0000-0000-000000000003', 'store_002');
    insert into program_tiers (program_id, threshold, coupon_title, benefit, sort_order) values
      ('00000000-0000-0000-0000-000000000001', 10, '성수 카페 10% 할인 쿠폰', '전 메뉴 10% 할인', 1),
      ('00000000-0000-0000-0000-000000000001', 20, '성수 카페 10,000원 할인 쿠폰', '10,000원 할인', 2),
      ('00000000-0000-0000-0000-000000000002', 10, '동네 한바퀴 1,000원 할인 쿠폰', '1,000원 할인', 1),
      ('00000000-0000-0000-0000-000000000003', 10, '동네 베이커리 무료 음료 쿠폰', '음료 1잔 무료', 1);
  end if;
  return true;
end; $$;
grant execute on function admin_reset_test_data(text, boolean) to anon, authenticated;

create or replace function admin_factory_reset(p_master_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if not admin_login_master(p_master_password) then return false; end if;
  delete from coupons;
  delete from stamp_events;
  delete from program_wallet;
  delete from user_programs;
  delete from stamp_wallet;
  delete from app_users;
  delete from program_stores;
  delete from program_tiers;
  delete from programs;
  delete from stores;
  insert into stores(id, name, category, active) values
    ('store_001', '성수 카페', '카페', true),
    ('store_002', '동네 베이커리', '베이커리', true),
    ('store_003', '한바퀴 식당', '음식점', true);
  insert into programs (id, name, description, scope, reset_on_tier, validity_days, active) values
    ('00000000-0000-0000-0000-000000000001', '성수 카페 단골적립', '성수 카페 전용 적립 프로그램', 'single_store', false, 30, true),
    ('00000000-0000-0000-0000-000000000002', '동네 한바퀴 공동적립', '제휴 매장 어디서나 함께 모으는 공동 적립', 'alliance', false, 30, true),
    ('00000000-0000-0000-0000-000000000003', '동네 베이커리 스탬프', '동네 베이커리 전용 적립 프로그램', 'single_store', false, 30, true);
  insert into program_stores (program_id, store_id) values
    ('00000000-0000-0000-0000-000000000001', 'store_001'),
    ('00000000-0000-0000-0000-000000000002', 'store_001'),
    ('00000000-0000-0000-0000-000000000002', 'store_002'),
    ('00000000-0000-0000-0000-000000000002', 'store_003'),
    ('00000000-0000-0000-0000-000000000003', 'store_002');
  insert into program_tiers (program_id, threshold, coupon_title, benefit, sort_order) values
    ('00000000-0000-0000-0000-000000000001', 10, '성수 카페 10% 할인 쿠폰', '전 메뉴 10% 할인', 1),
    ('00000000-0000-0000-0000-000000000001', 20, '성수 카페 10,000원 할인 쿠폰', '10,000원 할인', 2),
    ('00000000-0000-0000-0000-000000000002', 10, '동네 한바퀴 1,000원 할인 쿠폰', '1,000원 할인', 1),
    ('00000000-0000-0000-0000-000000000003', 10, '동네 베이커리 무료 음료 쿠폰', '음료 1잔 무료', 1);
  update app_config set goal_count = 10, cooldown_seconds = 30, coupon_validity_days = 30,
    master_password_hash = crypt('1234', gen_salt('bf')) where id = 1;
  return true;
end; $$;
grant execute on function admin_factory_reset(text) to anon, authenticated;

-- 완료: Table editor에서 stores / app_config / programs 등이 보이면 정상입니다.
-- 기본 마스터 관리자 비밀번호는 1234 입니다. 배포 후 관리자 화면에서 즉시 변경하세요.
