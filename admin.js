/* =============================================================================
 * admin.js — 관리자 화면 로직
 * 로그인은 서버(Supabase Postgres 함수)에서 비밀번호를 검증합니다.
 * - 총괄 관리자: 모든 매장을 관리 (기본 비밀번호 1234, 로그인 후 즉시 변경 권장)
 * - 매장 관리자: 매장별로 설정한 비밀번호로 로그인, 자기 매장 범위만 관리
 * 세션은 sessionStorage 에 보관되며 탭을 닫으면 사라집니다.
 * ========================================================================== */
(function (global) {
  'use strict';

  var SESS_KEY = 'nfc_admin_session';
  var TABS_MASTER = ['dashboard', 'programs', 'stores', 'stamps', 'coupons', 'reset'];
  var TABS_STORE = ['mystore', 'stamps', 'coupons'];
  var TAB_LABELS = {
    dashboard: '대시보드', programs: '프로그램 관리', stores: '매장 관리', stamps: '적립 내역',
    coupons: '쿠폰 관리', reset: '초기화', mystore: '내 매장'
  };
  var state = { tab: null };

  /* ------------------------------------------------- 세션 */
  function getSession() {
    try { return JSON.parse(global.sessionStorage.getItem(SESS_KEY) || 'null'); } catch (e) { return null; }
  }
  function setSession(sess) {
    try {
      sess ? global.sessionStorage.setItem(SESS_KEY, JSON.stringify(sess))
           : global.sessionStorage.removeItem(SESS_KEY);
    } catch (e) {}
  }
  function isMaster() { var s = getSession(); return !!s && s.role === 'master'; }
  function currentTabs() { return isMaster() ? TABS_MASTER : TABS_STORE; }

  /* ------------------------------------------------- 유틸 (app.js와 동일 계열) */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDateTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso); if (isNaN(d)) return '-';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getFullYear()) + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fmtDate(iso) {
    if (!iso) return '-';
    var d = new Date(iso); if (isNaN(d)) return '-';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
  }
  function shortCode(id) { return String(id).slice(-6).toUpperCase(); }
  function gotoUser() {
    if (global.__routes && global.__routes.toUser) return global.__routes.toUser();
    global.location.href = 'index.html';
  }
  function baseUserURL() {
    // 사용자 화면의 절대 URL 기준 (?store= 앞부분)
    var loc = global.location.origin + global.location.pathname;
    // 멀티파일: admin.html → index.html / 단일파일: 현재 파일이 곧 사용자 화면
    if (/admin\.html$/.test(loc)) return loc.replace(/admin\.html$/, 'index.html');
    return loc;
  }

  function toast(msg, kind) {
    var host = document.getElementById('toastHost'); if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg; host.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2200);
    setTimeout(function () { el.remove(); }, 2600);
  }

  function modal(opts) {
    var host = document.getElementById('modalHost');
    host.innerHTML =
      '<div class="modal">' +
        '<div class="m-body">' +
          '<div class="m-emoji">' + (opts.emoji || '❓') + '</div>' +
          '<div class="m-title">' + esc(opts.title || '') + '</div>' +
          '<div class="m-desc">' + (opts.desc || '') + '</div>' +
          (opts.formHTML || '') +
        '</div>' +
        '<div class="m-actions">' +
          (opts.cancel ? '<button class="btn ghost" id="mCancel">' + esc(opts.cancel) + '</button>' : '') +
          '<button class="btn ' + (opts.confirmClass || '') + '" id="mConfirm">' + esc(opts.confirm || '확인') + '</button>' +
        '</div>' +
      '</div>';
    host.classList.add('open');
    function close() { host.classList.remove('open'); host.innerHTML = ''; }
    global.__closeModal = close;
    document.getElementById('mConfirm').onclick = function () { opts.onConfirm ? opts.onConfirm(close) : close(); };
    var c = document.getElementById('mCancel');
    if (c) c.onclick = function () { close(); opts.onCancel && opts.onCancel(); };
    host.onclick = function (e) { if (e.target === host && opts.cancel) close(); };
    if (opts.afterOpen) opts.afterOpen();
  }

  /* =========================================================================
   * 렌더링
   * ====================================================================== */
  async function render() {
    var sess = getSession();
    if (!sess) { renderLogin(); return; }
    if (!state.tab || currentTabs().indexOf(state.tab) === -1) state.tab = currentTabs()[0];
    await renderShell();
  }

  /* ------------------------------------------------- 로그인 */
  function renderLogin() {
    var app = document.getElementById('app');
    app.innerHTML =
      '<div class="onboard">' +
        '<div class="hero">' +
          '<div class="big-logo" style="background:var(--text)">🔐</div>' +
          '<h1>관리자 로그인</h1>' +
          '<p>매장 운영자 전용 화면입니다.</p>' +
        '</div>' +
        '<div class="card">' +
          '<div class="admin-tabs" id="loginModeTabs" style="margin-bottom:14px">' +
            '<button id="modeMaster" class="active">총괄 관리자</button>' +
            '<button id="modeStore">매장 관리자</button>' +
          '</div>' +
          '<div id="loginFields"></div>' +
          '<button class="btn" id="loginBtn" style="margin-top:6px">로그인</button>' +
          '<div class="admin-note">⚠️ 총괄 관리자 기본 비밀번호는 1234입니다. 로그인 후 반드시 변경하세요.<br/>매장 관리자 비밀번호는 총괄 관리자가 매장 관리 화면에서 설정할 수 있습니다.</div>' +
        '</div>' +
        '<div style="text-align:center"><button class="link-btn" id="toUser">← 사용자 화면으로</button></div>' +
      '</div>';

    var mode = 'master';
    function renderFields() {
      var host = document.getElementById('loginFields');
      if (mode === 'master') {
        host.innerHTML =
          '<div class="field"><label>총괄 관리자 비밀번호</label>' +
            '<input class="input" id="pw" type="password" placeholder="비밀번호" /></div>';
      } else {
        host.innerHTML =
          '<div class="field"><label>매장 선택</label><select class="input" id="storeSel"><option>불러오는 중…</option></select></div>' +
          '<div class="field"><label>매장 비밀번호</label>' +
            '<input class="input" id="pw" type="password" placeholder="비밀번호" /></div>';
        DB.getStores().then(function (stores) {
          var sel = document.getElementById('storeSel');
          if (!sel) return;
          sel.innerHTML = stores.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('');
        }).catch(function () { toast('매장 목록을 불러오지 못했어요.', 'err'); });
      }
      var pw = document.getElementById('pw');
      pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryLogin(); });
    }
    document.getElementById('modeMaster').onclick = function () {
      mode = 'master';
      document.getElementById('modeMaster').classList.add('active');
      document.getElementById('modeStore').classList.remove('active');
      renderFields();
    };
    document.getElementById('modeStore').onclick = function () {
      mode = 'store';
      document.getElementById('modeStore').classList.add('active');
      document.getElementById('modeMaster').classList.remove('active');
      renderFields();
    };
    renderFields();

    async function tryLogin() {
      var btn = document.getElementById('loginBtn');
      var pw = document.getElementById('pw').value;
      btn.disabled = true;
      try {
        if (mode === 'master') {
          var ok = await DB.adminLoginMaster(pw);
          if (!ok) { toast('비밀번호가 올바르지 않습니다.', 'err'); btn.disabled = false; return; }
          setSession({ role: 'master', password: pw });
        } else {
          var storeId = document.getElementById('storeSel').value;
          if (!storeId) { toast('매장을 선택해 주세요.', 'warn'); btn.disabled = false; return; }
          var ok2 = await DB.adminLoginStore(storeId, pw);
          if (!ok2) { toast('비밀번호가 올바르지 않습니다. (아직 비밀번호가 설정되지 않았을 수 있어요)', 'err'); btn.disabled = false; return; }
          setSession({ role: 'store', storeId: storeId, password: pw });
        }
        toast('로그인되었습니다.', 'ok');
        state.tab = null;
        render();
      } catch (e) {
        toast('네트워크 오류가 발생했어요. 다시 시도해 주세요.', 'err');
        btn.disabled = false;
      }
    }
    document.getElementById('loginBtn').onclick = tryLogin;
    document.getElementById('toUser').onclick = function () { gotoUser(); };
  }

  /* ------------------------------------------------- 관리자 셸 */
  async function renderShell() {
    var app = document.getElementById('app');
    var tabs = currentTabs();
    var storeLabel = '';
    if (!isMaster()) { var st = await DB.getStore(getSession().storeId); storeLabel = ' · ' + esc(st ? st.name : ''); }
    app.innerHTML =
      '<header class="appbar">' +
        '<div class="brand"><div class="logo" style="background:var(--text)">A</div><div class="title">관리자' + storeLabel + '</div></div>' +
        '<div style="display:flex;gap:10px;align-items:center">' +
          '<button class="link-btn" id="toUser">사용자 화면</button>' +
          '<button class="link-btn" id="logout" style="color:var(--danger)">로그아웃</button>' +
        '</div>' +
      '</header>' +
      '<div class="screen">' +
        '<div class="admin-tabs" id="adminTabs">' +
          tabs.map(function (t) { return tab(t, TAB_LABELS[t]); }).join('') +
        '</div>' +
        '<div id="adminBody"></div>' +
      '</div>';

    document.getElementById('toUser').onclick = function () { gotoUser(); };
    document.getElementById('logout').onclick = function () { setSession(null); render(); };
    tabs.forEach(function (t) {
      document.getElementById('atab-' + t).onclick = function () { state.tab = t; renderBody(); highlightTabs(); };
    });
    await renderBody(); highlightTabs();
  }

  function tab(key, label) {
    return '<button id="atab-' + key + '">' + label + '</button>';
  }
  function highlightTabs() {
    currentTabs().forEach(function (t) {
      var b = document.getElementById('atab-' + t);
      if (b) b.classList.toggle('active', t === state.tab);
    });
  }

  async function renderBody() {
    var body = document.getElementById('adminBody');
    if (state.tab === 'dashboard') return renderDashboard(body);
    if (state.tab === 'programs') return renderPrograms(body);
    if (state.tab === 'stores') return renderStores(body);
    if (state.tab === 'mystore') return renderMyStore(body);
    if (state.tab === 'stamps') return renderStamps(body);
    if (state.tab === 'coupons') return renderCoupons(body);
    if (state.tab === 'reset') return renderReset(body);
  }

  /* ------------------------------------------------- 대시보드 (총괄 전용) */
  async function renderDashboard(body) {
    var s = await DB.getStats();
    var cfg = await DB.getConfig();
    body.innerHTML =
      '<div class="stat-grid">' +
        stat(s.userCount, '등록 사용자', false) +
        stat(s.totalStamps, '전체 스탬프 적립', false) +
        stat(s.couponsIssued, '발급 쿠폰', false) +
        stat(s.couponsAvailable, '사용 가능 쿠폰', true) +
        stat(s.couponsUsed, '사용 완료 쿠폰', true) +
        stat(s.couponsExpired, '기간 만료 쿠폰', true) +
      '</div>' +
      '<div class="spacer-16"></div>' +
      '<div class="section-title">운영 설정</div>' +
      '<div class="card">' +
        '<div class="field"><label>목표 스탬프 수 (쿠폰 발급 기준)</label>' +
          '<input class="input" id="cfgGoal" type="number" min="1" value="' + cfg.goalCount + '" /></div>' +
        '<div class="field"><label>중복 적립 방지 시간 (초) — 0이면 제한 없음</label>' +
          '<input class="input" id="cfgCooldown" type="number" min="0" value="' + cfg.cooldownSeconds + '" /></div>' +
        '<div class="field"><label>쿠폰 유효기간 (일)</label>' +
          '<input class="input" id="cfgValidity" type="number" min="1" value="' + cfg.couponValidityDays + '" /></div>' +
        '<button class="btn" id="saveCfg">설정 저장</button>' +
      '</div>' +
      '<div class="spacer-16"></div>' +
      '<div class="section-title">총괄 관리자 비밀번호 변경</div>' +
      '<div class="card">' +
        '<div class="field"><label>현재 비밀번호</label><input class="input" id="pwOld" type="password" /></div>' +
        '<div class="field"><label>새 비밀번호 (4자 이상)</label><input class="input" id="pwNew" type="password" /></div>' +
        '<button class="btn secondary" id="savePw">비밀번호 변경</button>' +
      '</div>';
    document.getElementById('saveCfg').onclick = async function () {
      var res = await DB.updateConfig(getSession().password, {
        goalCount: document.getElementById('cfgGoal').value,
        cooldownSeconds: document.getElementById('cfgCooldown').value,
        couponValidityDays: document.getElementById('cfgValidity').value
      });
      if (!res.ok) { toast(res.message, 'err'); return; }
      toast('설정이 저장되었습니다.', 'ok');
      renderDashboard(body);
    };
    document.getElementById('savePw').onclick = async function () {
      var oldPw = document.getElementById('pwOld').value;
      var newPw = document.getElementById('pwNew').value;
      try {
        var ok = await DB.adminChangeMasterPassword(oldPw, newPw);
        if (!ok) { toast('현재 비밀번호가 올바르지 않습니다.', 'err'); return; }
        var sess = getSession(); sess.password = newPw; setSession(sess);
        toast('비밀번호가 변경되었습니다.', 'ok');
        document.getElementById('pwOld').value = ''; document.getElementById('pwNew').value = '';
      } catch (e) { toast(e.message || '비밀번호 변경에 실패했습니다.', 'err'); }
    };
  }
  function stat(v, k, apri) {
    return '<div class="stat ' + (apri ? 'apri' : '') + '"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>';
  }

  /* ------------------------------------------------- 프로그램(캠페인) 관리 (총괄 전용) */
  async function renderPrograms(body) {
    var [programs, stores] = await Promise.all([DB.getPrograms(), DB.getStores()]);
    var storeById = {}; stores.forEach(function (s) { storeById[s.id] = s; });
    var html = '<button class="btn accent" id="addProgram" style="margin-bottom:12px">+ 프로그램 추가</button>';
    for (var i = 0; i < programs.length; i++) {
      var p = programs[i];
      var stats = await DB.getProgramStats(p.id);
      var storeNames = p.storeIds.map(function (id) { return storeById[id] ? storeById[id].name : id; }).join(', ');
      var tiersText = p.tiers.map(function (t) { return t.threshold + '개→' + t.couponTitle; }).join(' / ');
      html += '<div class="trow">' +
          '<div class="th"><div class="tt">' + esc(p.name) + '</div>' +
            (p.active ? '<span class="badge green">운영중</span>' : '<span class="badge gray">중지</span>') + '</div>' +
          '<div class="kv">' +
            '<span>범위 <b>' + (p.scope === 'alliance' ? '공동적립' : '단일매장') + '</b></span>' +
            '<span>대상 매장 <b>' + esc(storeNames || '-') + '</b></span>' +
            '<span>참여자 <b>' + stats.participants + '</b>명</span>' +
            '<span>발급 쿠폰 <b>' + stats.couponsIssued + '</b>건</span>' +
          '</div>' +
          '<div class="kv"><span>단계 <b>' + esc(tiersText || '-') + '</b></span></div>' +
          '<div class="acts">' +
            '<button class="btn secondary sm" data-edit-prog="' + p.id + '">정보 수정</button>' +
            '<button class="btn ghost sm" data-toggle-prog="' + p.id + '">' + (p.active ? '운영 중지' : '운영 시작') + '</button>' +
          '</div>' +
        '</div>';
    }
    body.innerHTML = html;
    document.getElementById('addProgram').onclick = function () { programForm(null); };
    body.querySelectorAll('[data-edit-prog]').forEach(function (b) {
      b.onclick = function () {
        var p = programs.filter(function (x) { return x.id === b.getAttribute('data-edit-prog'); })[0];
        programForm(p);
      };
    });
    body.querySelectorAll('[data-toggle-prog]').forEach(function (b) {
      b.onclick = async function () {
        var id = b.getAttribute('data-toggle-prog');
        var p = programs.filter(function (x) { return x.id === id; })[0];
        var ok = await DB.adminSetProgramActive(id, getSession().password, !p.active);
        if (!ok) { toast('처리에 실패했습니다.', 'err'); return; }
        toast('운영 상태를 변경했습니다.', 'ok');
        renderPrograms(body);
      };
    });
  }

  function programForm(program) {
    var editing = !!program;
    var tiers = editing
      ? program.tiers.map(function (t) { return { threshold: t.threshold, couponTitle: t.couponTitle, benefit: t.benefit }; })
      : [{ threshold: 10, couponTitle: '', benefit: '' }];
    var selectedStores = editing ? program.storeIds.slice() : [];

    DB.getStores().then(function (stores) {
      modal({
        emoji: editing ? '✏️' : '🗂️',
        title: editing ? '프로그램 수정' : '프로그램 추가',
        formHTML:
          '<div style="text-align:left;margin-top:8px">' +
            '<div class="field"><label>프로그램명</label><input class="input" id="pgName" value="' + (editing ? esc(program.name) : '') + '" placeholder="예: 성수 카페 단골적립" /></div>' +
            '<div class="field"><label>설명</label><input class="input" id="pgDesc" value="' + (editing ? esc(program.description) : '') + '" placeholder="선택 사항" /></div>' +
            '<div class="field"><label>범위</label><select class="input" id="pgScope">' +
              '<option value="single_store"' + ((!editing || program.scope === 'single_store') ? ' selected' : '') + '>단일 매장</option>' +
              '<option value="alliance"' + (editing && program.scope === 'alliance' ? ' selected' : '') + '>제휴 공동적립</option>' +
            '</select></div>' +
            '<div class="field"><label>대상 매장</label><div id="pgStores">' +
              stores.map(function (s) {
                var checked = selectedStores.indexOf(s.id) !== -1 ? ' checked' : '';
                return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0"><input type="checkbox" value="' + esc(s.id) + '"' + checked + ' /> ' + esc(s.name) + '</label>';
              }).join('') +
            '</div></div>' +
            '<div class="field"><label>쿠폰 유효기간(일)</label><input class="input" id="pgValidity" type="number" min="1" value="' + (editing ? program.validityDays : 30) + '" /></div>' +
            '<div class="field"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="pgReset"' + (editing && program.resetOnTier ? ' checked' : '') + ' /> 단계 달성 시 초과분만 남기고 초기화(반복형)</label></div>' +
            '<div class="field"><label>단계(티어)</label><div id="pgTiers"></div>' +
              '<button type="button" class="btn ghost sm" id="pgAddTier" style="margin-top:6px">+ 단계 추가</button></div>' +
          '</div>',
        confirm: editing ? '저장' : '추가', confirmClass: 'accent', cancel: '취소',
        onConfirm: async function (close) {
          var name = document.getElementById('pgName').value;
          var description = document.getElementById('pgDesc').value;
          var scope = document.getElementById('pgScope').value;
          var validityDays = parseInt(document.getElementById('pgValidity').value, 10) || 30;
          var resetOnTier = document.getElementById('pgReset').checked;
          var storeIds = Array.prototype.map.call(
            document.querySelectorAll('#pgStores input[type=checkbox]:checked'),
            function (el) { return el.value; }
          );
          if (!name.trim()) { toast('프로그램명을 입력해 주세요.', 'warn'); return; }
          if (storeIds.length === 0) { toast('대상 매장을 1곳 이상 선택해 주세요.', 'warn'); return; }
          if (tiers.length === 0) { toast('단계를 1개 이상 추가해 주세요.', 'warn'); return; }
          for (var i = 0; i < tiers.length; i++) {
            if (!tiers[i].threshold || !tiers[i].couponTitle.trim()) { toast('단계 정보를 모두 입력해 주세요.', 'warn'); return; }
          }
          var payload = { name: name, description: description, scope: scope, storeIds: storeIds, tiers: tiers, validityDays: validityDays, resetOnTier: resetOnTier };
          var sess = getSession();
          if (editing) {
            payload.active = program.active;
            var res = await DB.adminUpdateProgram(sess.password, program.id, payload);
            close();
            if (!res.ok) { toast(res.message, 'err'); return; }
            toast('프로그램을 수정했습니다.', 'ok');
          } else {
            var res2 = await DB.adminCreateProgram(sess.password, payload);
            close();
            if (!res2.ok) { toast(res2.message, 'err'); return; }
            toast('프로그램을 추가했습니다.', 'ok');
          }
          renderPrograms(document.getElementById('adminBody'));
        },
        afterOpen: function () {
          function renderTiers() {
            var host = document.getElementById('pgTiers');
            host.innerHTML = tiers.map(function (t, i) {
              return '<div style="display:flex;gap:6px;margin-bottom:6px">' +
                '<input class="input" style="flex:0 0 70px" type="number" min="1" placeholder="개수" value="' + (t.threshold || '') + '" data-tf="threshold" data-i="' + i + '" />' +
                '<input class="input" style="flex:1" placeholder="쿠폰명" value="' + esc(t.couponTitle || '') + '" data-tf="couponTitle" data-i="' + i + '" />' +
                '<input class="input" style="flex:1" placeholder="혜택 설명" value="' + esc(t.benefit || '') + '" data-tf="benefit" data-i="' + i + '" />' +
                (tiers.length > 1 ? '<button type="button" class="btn ghost sm" data-tier-del="' + i + '">✕</button>' : '') +
              '</div>';
            }).join('');
            host.querySelectorAll('[data-tf]').forEach(function (el) {
              el.oninput = function () {
                var i = parseInt(el.getAttribute('data-i'), 10);
                var f = el.getAttribute('data-tf');
                tiers[i][f] = f === 'threshold' ? (parseInt(el.value, 10) || 0) : el.value;
              };
            });
            host.querySelectorAll('[data-tier-del]').forEach(function (el) {
              el.onclick = function () {
                tiers.splice(parseInt(el.getAttribute('data-tier-del'), 10), 1);
                renderTiers();
              };
            });
          }
          renderTiers();
          document.getElementById('pgAddTier').onclick = function () {
            var lastThreshold = tiers.length ? (tiers[tiers.length - 1].threshold || 0) : 0;
            tiers.push({ threshold: lastThreshold + 10, couponTitle: '', benefit: '' });
            renderTiers();
          };
        }
      });
    });
  }

  /* ------------------------------------------------- 매장 관리 (총괄 전용) */
  async function renderStores(body) {
    var stores = await DB.getStores();
    var html = '<button class="btn accent" id="addStore" style="margin-bottom:12px">+ 매장 추가</button>';
    stores.forEach(function (st) {
      var url = baseUserURL() + '?store=' + encodeURIComponent(st.id);
      html +=
        '<div class="trow">' +
          '<div class="th">' +
            '<div class="tt">' + esc(st.name) + '</div>' +
            (st.active ? '<span class="badge green">운영중</span>' : '<span class="badge gray">중지</span>') +
          '</div>' +
          '<div class="kv"><span>ID <b>' + esc(st.id) + '</b></span><span>카테고리 <b>' + esc(st.category) + '</b></span></div>' +
          '<div class="url-box"><code id="url-' + st.id + '">' + esc(url) + '</code>' +
            '<button class="btn ghost sm" data-copy="' + esc(url) + '">복사</button></div>' +
          '<div class="acts">' +
            '<button class="btn accent sm" data-qr="' + st.id + '">📷 QR 코드</button>' +
            '<button class="btn secondary sm" data-edit="' + st.id + '">정보 수정</button>' +
            '<button class="btn secondary sm" data-pw="' + st.id + '">🔑 매장 비밀번호 설정</button>' +
            '<button class="btn ghost sm" data-toggle="' + st.id + '">' + (st.active ? '운영 중지' : '운영 시작') + '</button>' +
            '<button class="btn ghost sm" data-test="' + esc(url) + '">URL 테스트 ↗</button>' +
          '</div>' +
        '</div>';
    });
    body.innerHTML = html;

    document.getElementById('addStore').onclick = function () { storeForm(null); };
    body.querySelectorAll('[data-copy]').forEach(function (b) {
      b.onclick = function () { copyText(b.getAttribute('data-copy'), b); };
    });
    body.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = async function () { storeForm(await DB.getStore(b.getAttribute('data-edit'))); };
    });
    body.querySelectorAll('[data-pw]').forEach(function (b) {
      b.onclick = function () { storePasswordForm(b.getAttribute('data-pw')); };
    });
    body.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.onclick = async function () {
        var id = b.getAttribute('data-toggle');
        var st = await DB.getStore(id);
        var ok = await DB.adminSetStoreActive(id, getSession().password, !st.active);
        if (!ok) { toast('처리에 실패했습니다.', 'err'); return; }
        toast('운영 상태를 변경했습니다.', 'ok');
        renderStores(body);
      };
    });
    body.querySelectorAll('[data-test]').forEach(function (b) {
      b.onclick = function () { global.open(b.getAttribute('data-test'), '_blank'); };
    });
    body.querySelectorAll('[data-qr]').forEach(function (b) {
      b.onclick = async function () { qrModal(await DB.getStore(b.getAttribute('data-qr'))); };
    });
  }

  /* ------------------------------------------------- 내 매장 (매장 관리자 전용) */
  async function renderMyStore(body) {
    var sess = getSession();
    var st = await DB.getStore(sess.storeId);
    if (!st) { body.innerHTML = '<div class="card"><div class="empty">매장 정보를 불러오지 못했습니다.</div></div>'; return; }
    var url = baseUserURL() + '?store=' + encodeURIComponent(st.id);
    body.innerHTML =
      '<div class="trow">' +
        '<div class="th"><div class="tt">' + esc(st.name) + '</div>' +
          (st.active ? '<span class="badge green">운영중</span>' : '<span class="badge gray">중지</span>') + '</div>' +
        '<div class="kv"><span>ID <b>' + esc(st.id) + '</b></span><span>카테고리 <b>' + esc(st.category) + '</b></span></div>' +
        '<div class="url-box"><code>' + esc(url) + '</code><button class="btn ghost sm" id="myCopy">복사</button></div>' +
        '<div class="acts">' +
          '<button class="btn accent sm" id="myQr">📷 QR 코드</button>' +
          '<button class="btn ghost sm" id="myToggle">' + (st.active ? '운영 중지' : '운영 시작') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="spacer-16"></div>' +
      '<div class="section-title">매장 정보 수정</div>' +
      '<div class="card">' +
        '<div class="field"><label>매장명</label><input class="input" id="myName" value="' + esc(st.name) + '" /></div>' +
        '<div class="field"><label>카테고리</label><input class="input" id="myCat" value="' + esc(st.category) + '" /></div>' +
        '<button class="btn" id="mySave">저장</button>' +
      '</div>' +
      '<div class="spacer-16"></div>' +
      '<div class="section-title">비밀번호 변경</div>' +
      '<div class="card">' +
        '<div class="field"><label>현재 비밀번호</label><input class="input" id="myPwOld" type="password" /></div>' +
        '<div class="field"><label>새 비밀번호 (4자 이상)</label><input class="input" id="myPwNew" type="password" /></div>' +
        '<button class="btn secondary" id="myPwSave">비밀번호 변경</button>' +
      '</div>';

    document.getElementById('myCopy').onclick = function () { copyText(url, document.getElementById('myCopy')); };
    document.getElementById('myQr').onclick = function () { qrModal(st); };
    document.getElementById('myToggle').onclick = async function () {
      var ok = await DB.adminSetStoreActive(st.id, sess.password, !st.active);
      if (!ok) { toast('처리에 실패했습니다.', 'err'); return; }
      toast('운영 상태를 변경했습니다.', 'ok');
      renderMyStore(body);
    };
    document.getElementById('mySave').onclick = async function () {
      var ok = await DB.adminUpdateStoreInfo(st.id, sess.password,
        document.getElementById('myName').value, document.getElementById('myCat').value);
      if (!ok) { toast('저장에 실패했습니다.', 'err'); return; }
      toast('매장 정보를 저장했습니다.', 'ok');
      renderMyStore(body);
    };
    document.getElementById('myPwSave').onclick = async function () {
      var oldPw = document.getElementById('myPwOld').value;
      var newPw = document.getElementById('myPwNew').value;
      try {
        var ok = await DB.adminSetStorePassword(st.id, oldPw, newPw);
        if (!ok) { toast('현재 비밀번호가 올바르지 않습니다.', 'err'); return; }
        sess.password = newPw; setSession(sess);
        toast('비밀번호가 변경되었습니다.', 'ok');
        document.getElementById('myPwOld').value = ''; document.getElementById('myPwNew').value = '';
      } catch (e) { toast(e.message || '비밀번호 변경에 실패했습니다.', 'err'); }
    };
  }

  function storePasswordForm(storeId) {
    modal({
      emoji: '🔑', title: '매장 비밀번호 설정',
      desc: '이 매장 전용 관리자 로그인 비밀번호를 설정합니다.<br/>매장 사장님이 이 비밀번호로 자기 매장만 관리할 수 있어요.',
      formHTML: '<div class="field" style="text-align:left;margin-top:8px"><label>새 비밀번호 (4자 이상)</label>' +
        '<input class="input" id="newStorePw" type="password" /></div>',
      confirm: '설정', confirmClass: 'accent', cancel: '취소',
      onConfirm: async function (close) {
        var newPw = document.getElementById('newStorePw').value;
        try {
          var ok = await DB.adminSetStorePassword(storeId, getSession().password, newPw);
          close();
          if (!ok) { toast('설정에 실패했습니다.', 'err'); return; }
          toast('매장 비밀번호가 설정되었습니다.', 'ok');
        } catch (e) { close(); toast(e.message || '설정에 실패했습니다.', 'err'); }
      }
    });
  }

  /* ------------------------------------------------- 매장 QR 코드 모달 */
  function qrModal(store) {
    if (!store) return;
    var url = baseUserURL() + '?store=' + encodeURIComponent(store.id);
    if (!global.QR || !global.qrcode) { toast('QR 라이브러리를 불러오지 못했습니다.', 'err'); return; }
    modal({
      emoji: '📷',
      title: store.name + ' QR',
      desc: '손님이 이 QR을 카메라로 스캔하면<br/>NFC 태그와 똑같이 적립 화면이 열립니다.',
      formHTML:
        '<div id="qrHost" style="display:flex;justify-content:center;margin:14px 0 6px"></div>' +
        '<div class="url-box" style="margin-bottom:4px"><code>' + esc(url) + '</code>' +
          '<button class="btn ghost sm" id="qrCopy">복사</button></div>' +
        '<div style="display:flex;gap:8px;margin-top:10px">' +
          '<button class="btn secondary sm block" id="qrSave" style="flex:1">PNG 저장</button>' +
          '<button class="btn ghost sm block" id="qrPrint" style="flex:1">인쇄</button>' +
        '</div>' +
        '<div class="hint" style="text-align:center;margin-top:8px">이 QR을 매장에 부착하거나, 화면 그대로 스캔해 시연하세요.</div>',
      confirm: '닫기', confirmClass: 'ghost',
      onConfirm: function (close) { close(); },
      afterOpen: function () {
        var host = document.getElementById('qrHost');
        try {
          var cv = global.QR.toCanvas(url, 480);
          cv.style.width = '220px'; cv.style.height = '220px';
          cv.style.imageRendering = 'pixelated';
          cv.style.border = '1px solid var(--line)';
          cv.style.borderRadius = '12px'; cv.style.padding = '10px';
          cv.style.background = '#fff';
          host.appendChild(cv);
        } catch (e) { host.textContent = 'QR 생성 실패'; }
        var fname = 'QR_' + store.id;
        document.getElementById('qrSave').onclick = function () {
          var ok = global.QR.downloadPng(url, fname, 720);
          toast(ok ? 'QR 이미지를 저장했습니다.' : '이 환경에서는 저장이 제한됩니다. QR을 길게 눌러 저장하세요.', ok ? 'ok' : 'warn');
        };
        document.getElementById('qrPrint').onclick = function () {
          var ok = global.QR.printQR(url, store.name, store.category + ' · ' + store.id);
          if (!ok) toast('이 환경에서는 인쇄 창을 열 수 없습니다.', 'warn');
        };
        document.getElementById('qrCopy').onclick = function () { copyText(url, document.getElementById('qrCopy')); };
      }
    });
  }

  function storeForm(store) {
    var editing = !!store;
    modal({
      emoji: editing ? '✏️' : '🏪',
      title: editing ? '매장 정보 수정' : '매장 추가',
      desc: '',
      formHTML:
        '<div style="text-align:left;margin-top:8px">' +
          '<div class="field"><label>매장명</label><input class="input" id="fName" value="' + (editing ? esc(store.name) : '') + '" placeholder="예: 성수 카페" /></div>' +
          '<div class="field"><label>카테고리</label><input class="input" id="fCat" value="' + (editing ? esc(store.category) : '') + '" placeholder="예: 카페" /></div>' +
          (editing
            ? '<div class="field"><label>매장 ID</label><input class="input" value="' + esc(store.id) + '" disabled /></div>'
            : '<div class="field"><label>매장 ID (선택 — 비우면 자동 생성)</label><input class="input" id="fId" placeholder="예: store_004" /></div>') +
        '</div>',
      confirm: editing ? '저장' : '추가', confirmClass: 'accent', cancel: '취소',
      onConfirm: async function (close) {
        var payload = {
          name: document.getElementById('fName').value,
          category: document.getElementById('fCat').value
        };
        if (editing) payload.id = store.id;
        else { var idv = (document.getElementById('fId').value || '').trim(); if (idv) payload.id = idv; }
        if (!payload.name.trim()) { toast('매장명을 입력해 주세요.', 'warn'); return; }
        var sess = getSession();
        if (editing) {
          var ok = await DB.adminUpdateStoreInfo(payload.id, sess.password, payload.name, payload.category);
          close();
          if (!ok) { toast('저장에 실패했습니다.', 'err'); return; }
          toast('매장 정보를 수정했습니다.', 'ok');
        } else {
          var res = await DB.adminCreateStore(sess.password, payload.id, payload.name, payload.category);
          close();
          if (!res.ok) { toast(res.message, 'err'); return; }
          toast('매장을 추가했습니다.', 'ok');
        }
        renderStores(document.getElementById('adminBody'));
      }
    });
  }

  function copyText(text, btn) {
    function done() { if (btn) { var o = btn.textContent; btn.textContent = '복사됨'; setTimeout(function () { btn.textContent = o; }, 1200); } toast('URL을 복사했습니다.', 'ok'); }
    if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else { fallbackCopy(text, done); }
  }
  function fallbackCopy(text, cb) {
    try {
      var ta = document.createElement('textarea'); ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); document.body.removeChild(ta); cb && cb();
    } catch (e) { toast('복사에 실패했습니다. URL을 길게 눌러 복사하세요.', 'warn'); }
  }

  /* ------------------------------------------------- 적립 내역 */
  async function renderStamps(body) {
    var sess = getSession();
    var events = await DB.getStampEvents(); // 최신순
    if (!isMaster()) events = events.filter(function (e) { return e.storeId === sess.storeId; });
    var html = '<div class="section-title">' + (isMaster() ? '전체' : '우리 매장') + ' 적립 내역 (' + events.length + '건)</div>';
    if (events.length === 0) { body.innerHTML = html + '<div class="card"><div class="empty"><div class="em">📜</div>적립 내역이 없습니다.</div></div>'; return; }
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var u = await DB.getUser(e.userId);
      var st = await DB.getStore(e.storeId);
      html +=
        '<div class="trow">' +
          '<div class="th"><div class="tt">' + esc(u ? u.name : '(삭제된 사용자)') + '</div>' +
            '<span class="badge blue">적립 후 ' + e.stampCountAfter + '개</span></div>' +
          '<div class="kv">' +
            '<span>일시 <b>' + fmtDateTime(e.stampedAt) + '</b></span>' +
            '<span>매장 <b>' + esc(st ? st.name : e.storeId) + '</b></span>' +
            '<span>식별 <b>' + (u ? '****' + esc(u.phoneLast4) : '-') + '</b></span>' +
            '<span>상태 <b>정상 적립</b></span>' +
          '</div>' +
        '</div>';
    }
    body.innerHTML = html;
  }

  /* ------------------------------------------------- 쿠폰 관리 */
  async function renderCoupons(body) {
    var sess = getSession();
    var coupons = await DB.getCoupons(); // 사용가능 우선
    var html = '<div class="section-title">발급 쿠폰 (' + coupons.length + '건)</div>';
    if (!isMaster()) {
      html = '<div class="hint" style="margin-bottom:10px">매장 관리자는 사용 가능한 쿠폰만 처리할 수 있어요. 손님이 보여준 쿠폰번호로 찾아 사용 처리하세요.</div>' + html;
    }
    if (coupons.length === 0) { body.innerHTML = html + '<div class="card"><div class="empty"><div class="em">🎟️</div>발급된 쿠폰이 없습니다.</div></div>'; return; }
    for (var i = 0; i < coupons.length; i++) {
      var c = coupons[i];
      var u = await DB.getUser(c.userId);
      var badge =
        c.status === 'available' ? '<span class="badge apri">사용 가능</span>' :
        c.status === 'used'      ? '<span class="badge gray">사용 완료</span>' :
                                   '<span class="badge red">기간 만료</span>';
      html +=
        '<div class="trow">' +
          '<div class="th"><div class="tt">' + esc(c.title) + '</div>' + badge + '</div>' +
          '<div class="kv">' +
            '<span>쿠폰ID <b>' + shortCode(c.id) + '</b></span>' +
            '<span>사용자 <b>' + esc(u ? u.name : '(삭제됨)') + '</b></span>' +
            '<span>발급 <b>' + fmtDate(c.issuedAt) + '</b></span>' +
            '<span>유효기간 <b>~' + fmtDate(c.expiresAt) + '</b></span>' +
            (c.usedAt ? '<span>사용일 <b>' + fmtDate(c.usedAt) + '</b></span>' : '') +
          '</div>' +
          '<div class="acts">' +
            (c.status === 'available'
              ? '<button class="btn accent sm" data-use="' + c.id + '">사용 처리</button>'
              : '<button class="btn ghost sm" disabled>' + (c.status === 'used' ? '사용 완료됨' : '만료됨') + '</button>') +
          '</div>' +
        '</div>';
    }
    body.innerHTML = html;

    var stores = isMaster() ? await DB.getStores() : null;
    body.querySelectorAll('[data-use]').forEach(function (b) {
      b.onclick = function () { confirmUse(b.getAttribute('data-use'), stores); };
    });
  }

  function confirmUse(couponId, storesForMaster) {
    var sess = getSession();
    var storeFieldHTML = '';
    if (storesForMaster) {
      storeFieldHTML = '<div class="field" style="text-align:left;margin-top:8px"><label>사용 처리할 매장</label>' +
        '<select class="input" id="useStoreSel">' +
        storesForMaster.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('') +
        '</select></div>';
    }
    modal({
      emoji: '✅', title: '쿠폰 사용 처리',
      desc: '이 쿠폰을 <b>사용 완료</b>로 처리할까요?<br/>처리 후에는 되돌릴 수 없습니다.',
      formHTML: storeFieldHTML,
      confirm: '사용 처리', confirmClass: 'accent', cancel: '취소',
      onConfirm: async function (close) {
        var storeId = storesForMaster ? document.getElementById('useStoreSel').value : sess.storeId;
        var res = await DB.useCoupon(couponId, storeId, sess.password);
        close();
        if (!res.ok) { toast(res.message, 'err'); }
        else { toast('쿠폰을 사용 처리했습니다.', 'ok'); }
        renderCoupons(document.getElementById('adminBody'));
      }
    });
  }

  /* ------------------------------------------------- 초기화 (총괄 전용) */
  function renderReset(body) {
    body.innerHTML =
      '<div class="danger-zone">' +
        '<h3>⚠️ 전체 테스트 데이터 초기화</h3>' +
        '<p>사용자, 적립 내역, 쿠폰 내역을 모두 삭제합니다.<br/>매장 목록과 매장 비밀번호는 유지됩니다.<br/>이 작업은 되돌릴 수 없습니다.</p>' +
        '<button class="btn danger" id="resetBtn">전체 테스트 데이터 초기화</button>' +
      '</div>' +
      '<div class="spacer-16"></div>' +
      '<div class="card">' +
        '<div class="tt" style="font-weight:700;margin-bottom:6px">공장 초기화</div>' +
        '<p style="font-size:13px;color:var(--text-2);margin:0 0 12px">매장·비밀번호·설정을 포함한 모든 데이터를 기본 상태(매장 3곳, 마스터 비밀번호 1234)로 완전히 되돌립니다.</p>' +
        '<button class="btn ghost" id="factoryBtn" style="color:var(--danger)">공장 초기화 (매장까지 기본값으로)</button>' +
      '</div>';

    document.getElementById('resetBtn').onclick = function () {
      modal({
        emoji: '🗑️', title: '정말 초기화할까요?',
        desc: '사용자 · 적립 · 쿠폰 데이터가 모두 삭제됩니다.<br/>이 작업은 되돌릴 수 없습니다.',
        confirm: '초기화', confirmClass: 'danger', cancel: '취소',
        onConfirm: async function (close) {
          var ok = await DB.resetTestData(getSession().password, true);
          close();
          if (!ok) { toast('초기화에 실패했습니다.', 'err'); return; }
          toast('테스트 데이터를 초기화했습니다.', 'ok'); state.tab = 'dashboard'; renderShell();
        }
      });
    };
    document.getElementById('factoryBtn').onclick = function () {
      modal({
        emoji: '🏭', title: '공장 초기화',
        desc: '매장·비밀번호·설정을 포함한 <b>모든 데이터</b>가 기본 상태로 돌아갑니다.',
        confirm: '공장 초기화', confirmClass: 'danger', cancel: '취소',
        onConfirm: async function (close) {
          var ok = await DB.factoryReset(getSession().password);
          close();
          if (!ok) { toast('초기화에 실패했습니다.', 'err'); return; }
          setSession({ role: 'master', password: '1234' });
          toast('기본 상태로 초기화했습니다. (마스터 비밀번호: 1234)', 'ok'); state.tab = 'dashboard'; renderShell();
        }
      });
    };
  }

  /* =========================================================================
   * 진입점
   * ====================================================================== */
  async function initAdminApp() {
    await DB.init();
    try {
      await render();
    } catch (e) {
      console.error('[Admin] 초기 로딩 실패', e);
      var app = document.getElementById('app');
      if (app) {
        app.innerHTML = '<div class="onboard"><div class="card"><div class="empty">' +
          '<div class="em">⚠️</div>서버에 연결하지 못했어요.<br/>' +
          'supabase-config.js 설정을 확인하거나 잠시 후 새로고침 해주세요.</div></div></div>';
      }
    }
  }

  global.initAdminApp = initAdminApp;
  global.__adminApp = { render: render };

})(typeof window !== 'undefined' ? window : globalThis);
