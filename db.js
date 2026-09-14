/* =============================================================================
 * db.js — 데이터 레이어 (Data Access Layer)
 * -----------------------------------------------------------------------------
 * 실제 서버 DB(Supabase)를 사용합니다. 화면(app.js / admin.js)은 이 파일이
 * 노출하는 window.DB API만 호출하고, Supabase 클라이언트를 직접 다루지 않습니다.
 * 모든 함수는 네트워크 호출을 하므로 async 이며, 호출부는 await 해야 합니다.
 *
 * 비밀번호 검증·트랜잭션(적립/쿠폰 발급/쿠폰 사용 등)은 전부 서버 쪽
 * (Supabase Postgres 함수, supabase/schema.sql) 에서 처리되며, 클라이언트는
 * 결과만 받습니다. 실제 저장소 교체가 필요하면 이 파일만 바꾸면 됩니다.
 * ========================================================================== */
(function (global) {
  'use strict';

  var cfg = global.SUPABASE_CONFIG || {};
  if (!cfg.url || !cfg.anonKey || /YOUR_/.test(cfg.url) || /YOUR_/.test(cfg.anonKey)) {
    console.error('[DB] supabase-config.js 에 실제 Supabase URL/anonKey를 설정해 주세요.');
  }
  if (!global.supabase || typeof global.supabase.createClient !== 'function') {
    console.error('[DB] @supabase/supabase-js 스크립트가 로드되지 않았습니다.');
  }
  var sb = global.supabase.createClient(cfg.url, cfg.anonKey);

  var DEFAULTS = {
    couponTitle: '동네 한바퀴 무료 쿠폰',
    couponBenefit: '아메리카노 1잔 무료 (또는 3,000원 할인)'
  };

  /* ---------------------------------------------------------------------------
   * 유틸 — snake_case(DB row) ↔ camelCase(화면) 매핑
   * ------------------------------------------------------------------------ */
  function mapUser(r) { return r && { id: r.id, name: r.name, phoneLast4: r.phone_last4, createdAt: r.created_at }; }
  function mapStore(r) { return r && { id: r.id, name: r.name, category: r.category, active: r.active, createdAt: r.created_at }; }
  function mapWallet(r) { return r && { userId: r.user_id, currentStampCount: r.current_stamp_count, goalCount: r.goal_count, updatedAt: r.updated_at }; }
  function mapEvent(r) { return r && { id: r.id, userId: r.user_id, storeId: r.store_id, stampedAt: r.stamped_at, stampCountAfter: r.stamp_count_after, status: r.status, programId: r.program_id }; }
  function mapCoupon(r) { return r && { id: r.id, userId: r.user_id, title: r.title, benefit: r.benefit, issuedAt: r.issued_at, expiresAt: r.expires_at, status: r.status, usedAt: r.used_at, usedStoreId: r.used_store_id, programId: r.program_id, tierThreshold: r.tier_threshold, sourceStoreId: r.source_store_id }; }
  function mapConfig(r) { return r && { goalCount: r.goal_count, cooldownSeconds: r.cooldown_seconds, couponValidityDays: r.coupon_validity_days }; }
  function mapTier(r) { return r && { threshold: r.threshold, couponTitle: r.coupon_title, benefit: r.benefit, sortOrder: r.sort_order }; }

  function genericError(context) {
    console.error('[DB] ' + context);
    return { ok: false, message: '일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' };
  }

  /* ---------------------------------------------------------------------------
   * 초기화 (API 호환용 — 별도 로드 작업 없음)
   * ------------------------------------------------------------------------ */
  async function init() { return true; }

  /* ---------------------------------------------------------------------------
   * 조회 API (읽기) — 모든 테이블은 RLS로 SELECT만 공개되어 있음
   * ------------------------------------------------------------------------ */
  async function getConfig() {
    var res = await sb.from('app_config').select('*').eq('id', 1).maybeSingle();
    if (res.error || !res.data) throw res.error || new Error('config not found');
    return mapConfig(res.data);
  }

  async function getUser(userId) {
    if (!userId) return null;
    var res = await sb.from('app_users').select('*').eq('id', userId).maybeSingle();
    if (res.error || !res.data) return null;
    return mapUser(res.data);
  }

  async function getStores() {
    var res = await sb.from('stores').select('*').order('created_at', { ascending: true });
    if (res.error) throw res.error;
    return (res.data || []).map(mapStore);
  }

  async function getStore(storeId) {
    if (typeof storeId !== 'string' || !storeId) return null;
    var res = await sb.from('stores').select('*').eq('id', storeId).maybeSingle();
    if (res.error || !res.data) return null;
    return mapStore(res.data);
  }

  async function getWallet(userId) {
    var res = await sb.from('stamp_wallet').select('*').eq('user_id', userId).maybeSingle();
    if (res.error || !res.data) return { userId: userId, currentStampCount: 0, goalCount: 10, updatedAt: new Date().toISOString() };
    return mapWallet(res.data);
  }

  async function getStampEvents(userId) {
    var q = sb.from('stamp_events').select('*').order('stamped_at', { ascending: false });
    if (userId) q = q.eq('user_id', userId);
    var res = await q;
    if (res.error) throw res.error;
    return (res.data || []).map(mapEvent);
  }

  async function getCoupons(userId) {
    var q = sb.from('coupons').select('*');
    if (userId) q = q.eq('user_id', userId);
    var res = await q;
    if (res.error) throw res.error;
    var now = Date.now();
    var list = (res.data || []).map(mapCoupon).map(function (c) {
      if (c.status === 'available' && c.expiresAt && new Date(c.expiresAt).getTime() < now) c.status = 'expired';
      return c;
    });
    return list.sort(function (a, b) {
      var rank = { available: 0, used: 1, expired: 2 };
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return a.issuedAt < b.issuedAt ? 1 : -1;
    });
  }

  async function getUsers() {
    var res = await sb.from('app_users').select('*').order('created_at', { ascending: false });
    if (res.error) throw res.error;
    return (res.data || []).map(mapUser);
  }

  /* ---------------------------------------------------------------------------
   * 조회 API — 적립 프로그램(캠페인)
   * ------------------------------------------------------------------------ */
  async function getPrograms() {
    var [progRes, storesRes, tiersRes] = await Promise.all([
      sb.from('programs').select('*').order('created_at', { ascending: true }),
      sb.from('program_stores').select('*'),
      sb.from('program_tiers').select('*').order('sort_order', { ascending: true })
    ]);
    if (progRes.error) throw progRes.error;
    var storesByProgram = {};
    (storesRes.data || []).forEach(function (r) {
      (storesByProgram[r.program_id] = storesByProgram[r.program_id] || []).push(r.store_id);
    });
    var tiersByProgram = {};
    (tiersRes.data || []).forEach(function (r) {
      (tiersByProgram[r.program_id] = tiersByProgram[r.program_id] || []).push(mapTier(r));
    });
    return (progRes.data || []).map(function (r) {
      return {
        id: r.id, name: r.name, description: r.description, scope: r.scope,
        resetOnTier: r.reset_on_tier, validityDays: r.validity_days, active: r.active,
        createdAt: r.created_at,
        storeIds: storesByProgram[r.id] || [],
        tiers: tiersByProgram[r.id] || []
      };
    });
  }

  async function getProgram(programId) {
    var all = await getPrograms();
    return all.filter(function (p) { return p.id === programId; })[0] || null;
  }

  async function getUserProgramIds(userId) {
    var res = await sb.from('user_programs').select('program_id').eq('user_id', userId);
    if (res.error) throw res.error;
    return (res.data || []).map(function (r) { return r.program_id; });
  }

  async function getProgramWallets(userId) {
    var [walletRes, programs] = await Promise.all([
      sb.from('program_wallet').select('*').eq('user_id', userId),
      getPrograms()
    ]);
    if (walletRes.error) throw walletRes.error;
    var byId = {};
    programs.forEach(function (p) { byId[p.id] = p; });
    return (walletRes.data || []).map(function (w) {
      var p = byId[w.program_id];
      return {
        programId: w.program_id,
        programName: p ? p.name : '(삭제된 프로그램)',
        description: p ? p.description : '',
        scope: p ? p.scope : 'single_store',
        active: p ? p.active : false,
        storeIds: p ? p.storeIds : [],
        tiers: p ? p.tiers : [],
        currentCount: w.current_count,
        issuedTierThresholds: w.issued_tier_thresholds || [],
        updatedAt: w.updated_at
      };
    }).filter(function (w) { return !!byId[w.programId]; });
  }

  async function joinProgram(userId, programId) {
    var res = await sb.rpc('app_join_program', { p_user_id: userId, p_program_id: programId });
    if (res.error) return genericError('joinProgram: ' + res.error.message);
    return res.data;
  }

  async function getProgramStats(programId) {
    var [participantsRes, couponsRes] = await Promise.all([
      sb.from('user_programs').select('*', { count: 'exact', head: true }).eq('program_id', programId),
      sb.from('coupons').select('*', { count: 'exact', head: true }).eq('program_id', programId)
    ]);
    return {
      participants: participantsRes.count || 0,
      couponsIssued: couponsRes.count || 0
    };
  }

  /* ---------------------------------------------------------------------------
   * 쓰기 API — 사용자 / 적립 (서버 함수(RPC)에서 원자적으로 처리)
   * ------------------------------------------------------------------------ */
  async function createUser(name, phoneLast4) {
    var res = await sb.rpc('app_create_user', { p_name: name, p_phone_last4: phoneLast4 });
    if (res.error) return genericError('createUser: ' + res.error.message);
    if (!res.data.ok) return res.data;
    return { ok: true, user: mapUser(res.data.user) };
  }

  async function addStamp(userId, storeId) {
    var res = await sb.rpc('app_add_stamp', { p_user_id: userId, p_store_id: storeId });
    if (res.error) return genericError('addStamp: ' + res.error.message);
    if (!res.data.ok) return res.data;
    var d = res.data;
    return {
      ok: true, code: d.code, message: d.message,
      store: mapStore(d.store),
      results: (d.results || []).map(function (r) {
        return {
          programId: r.programId, programName: r.programName,
          currentCount: r.currentCount,
          coupon: r.coupon ? mapCoupon(r.coupon) : null
        };
      })
    };
  }

  /* ---------------------------------------------------------------------------
   * 관리자 API — 비밀번호 검증은 항상 서버(Postgres 함수)에서만 수행
   * ------------------------------------------------------------------------ */
  async function adminLoginMaster(password) {
    var res = await sb.rpc('admin_login_master', { p_password: password });
    return !res.error && res.data === true;
  }

  async function adminLoginStore(storeId, password) {
    var res = await sb.rpc('admin_login_store', { p_store_id: storeId, p_password: password });
    return !res.error && res.data === true;
  }

  async function adminCreateStore(masterPassword, id, name, category) {
    var res = await sb.rpc('admin_create_store', { p_master_password: masterPassword, p_id: id || null, p_name: name, p_category: category });
    if (res.error) return genericError('adminCreateStore: ' + res.error.message);
    if (!res.data.ok) return res.data;
    return { ok: true, store: mapStore(res.data.store) };
  }

  async function adminUpdateStoreInfo(storeId, password, name, category) {
    var res = await sb.rpc('admin_update_store_info', { p_store_id: storeId, p_password: password, p_name: name, p_category: category });
    return !res.error && res.data === true;
  }

  async function adminSetStoreActive(storeId, password, active) {
    var res = await sb.rpc('admin_set_store_active', { p_store_id: storeId, p_password: password, p_active: active });
    return !res.error && res.data === true;
  }

  async function adminSetStorePassword(storeId, password, newPassword) {
    var res = await sb.rpc('admin_set_store_password', { p_store_id: storeId, p_password: password, p_new_password: newPassword });
    if (res.error) throw new Error(res.error.message || '비밀번호 변경에 실패했습니다.');
    return res.data === true;
  }

  async function adminCreateProgram(masterPassword, payload) {
    var res = await sb.rpc('admin_create_program', {
      p_master_password: masterPassword,
      p_name: payload.name, p_description: payload.description || '', p_scope: payload.scope,
      p_store_ids: payload.storeIds, p_tiers: payload.tiers, p_validity_days: payload.validityDays,
      p_reset_on_tier: !!payload.resetOnTier
    });
    if (res.error) return genericError('adminCreateProgram: ' + res.error.message);
    return res.data;
  }

  async function adminUpdateProgram(masterPassword, programId, payload) {
    var res = await sb.rpc('admin_update_program', {
      p_master_password: masterPassword, p_program_id: programId,
      p_name: payload.name, p_description: payload.description, p_scope: payload.scope,
      p_store_ids: payload.storeIds || null, p_tiers: payload.tiers || null,
      p_validity_days: payload.validityDays, p_reset_on_tier: payload.resetOnTier,
      p_active: (payload.active != null) ? payload.active : null
    });
    if (res.error) return genericError('adminUpdateProgram: ' + res.error.message);
    return res.data;
  }

  async function adminSetProgramActive(programId, masterPassword, active) {
    var res = await sb.rpc('admin_set_program_active', { p_program_id: programId, p_master_password: masterPassword, p_active: active });
    return !res.error && res.data === true;
  }

  async function adminChangeMasterPassword(oldPassword, newPassword) {
    var res = await sb.rpc('admin_change_master_password', { p_old_password: oldPassword, p_new_password: newPassword });
    if (res.error) throw new Error(res.error.message || '비밀번호 변경에 실패했습니다.');
    return res.data === true;
  }

  async function useCoupon(couponId, storeId, password) {
    var res = await sb.rpc('admin_use_coupon', { p_coupon_id: couponId, p_store_id: storeId, p_password: password });
    if (res.error) return genericError('useCoupon: ' + res.error.message);
    if (!res.data.ok) return res.data;
    return { ok: true, coupon: mapCoupon(res.data.coupon) };
  }

  async function updateConfig(masterPassword, patch) {
    var res = await sb.rpc('admin_update_config', {
      p_master_password: masterPassword,
      p_goal_count: (patch && patch.goalCount != null) ? parseInt(patch.goalCount, 10) : null,
      p_cooldown_seconds: (patch && patch.cooldownSeconds != null) ? parseInt(patch.cooldownSeconds, 10) : null,
      p_coupon_validity_days: (patch && patch.couponValidityDays != null) ? parseInt(patch.couponValidityDays, 10) : null
    });
    if (res.error) return genericError('updateConfig: ' + res.error.message);
    if (!res.data.ok) return res.data;
    return { ok: true, config: mapConfig(res.data.config) };
  }

  async function resetTestData(masterPassword, keepStores) {
    var res = await sb.rpc('admin_reset_test_data', { p_master_password: masterPassword, p_keep_stores: keepStores !== false });
    return !res.error && res.data === true;
  }

  async function factoryReset(masterPassword) {
    var res = await sb.rpc('admin_factory_reset', { p_master_password: masterPassword });
    return !res.error && res.data === true;
  }

  /* ---------------------------------------------------------------------------
   * 통계 (대시보드)
   * ------------------------------------------------------------------------ */
  async function getStats() {
    var usersRes = await sb.from('app_users').select('*', { count: 'exact', head: true });
    var eventsRes = await sb.from('stamp_events').select('*', { count: 'exact', head: true });
    var couponsRes = await sb.from('coupons').select('status, expires_at');
    var coupons = couponsRes.data || [];
    var now = Date.now();
    var used = 0, available = 0, expired = 0;
    coupons.forEach(function (c) {
      var st = c.status;
      if (st === 'available' && c.expires_at && new Date(c.expires_at).getTime() < now) st = 'expired';
      if (st === 'available') available++; else if (st === 'used') used++; else expired++;
    });
    return {
      userCount: usersRes.count || 0,
      totalStamps: eventsRes.count || 0,
      couponsIssued: coupons.length,
      couponsUsed: used,
      couponsAvailable: available,
      couponsExpired: expired
    };
  }

  /* ---------------------------------------------------------------------------
   * 공개 API
   * ------------------------------------------------------------------------ */
  var DB = {
    // 초기화/설정
    init: init,
    getConfig: getConfig,
    updateConfig: updateConfig,
    // 사용자
    createUser: createUser,
    getUser: getUser,
    getUsers: getUsers,
    // 매장
    getStores: getStores,
    getStore: getStore,
    adminCreateStore: adminCreateStore,
    adminUpdateStoreInfo: adminUpdateStoreInfo,
    adminSetStoreActive: adminSetStoreActive,
    adminSetStorePassword: adminSetStorePassword,
    // 적립 프로그램(캠페인)
    getPrograms: getPrograms,
    getProgram: getProgram,
    getUserProgramIds: getUserProgramIds,
    getProgramWallets: getProgramWallets,
    joinProgram: joinProgram,
    getProgramStats: getProgramStats,
    adminCreateProgram: adminCreateProgram,
    adminUpdateProgram: adminUpdateProgram,
    adminSetProgramActive: adminSetProgramActive,
    // 적립/지갑
    addStamp: addStamp,
    getWallet: getWallet,
    getStampEvents: getStampEvents,
    // 쿠폰
    getCoupons: getCoupons,
    useCoupon: useCoupon,
    // 관리자 인증
    adminLoginMaster: adminLoginMaster,
    adminLoginStore: adminLoginStore,
    adminChangeMasterPassword: adminChangeMasterPassword,
    // 통계/초기화
    getStats: getStats,
    resetTestData: resetTestData,
    factoryReset: factoryReset,
    // 상수
    DEFAULTS: DEFAULTS
  };

  global.DB = DB;
  if (typeof module !== 'undefined' && module.exports) module.exports = DB;

})(typeof window !== 'undefined' ? window : globalThis);
