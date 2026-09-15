/* =============================================================================
 * app.js — 사용자 화면 로직
 * db.js(window.DB)만 통해 데이터에 접근합니다.
 * ========================================================================== */
(function (global) {
  'use strict';

  var CUR_KEY = 'nfc_current_user'; // 자동 로그인용(로컬 저장)
  var state = { tab: 'home', storeParam: null, lastStampAt: 0, busy: false };

  /* ------------------------------------------------- 세션(현재 사용자) */
  function getCurrentUserId() {
    try { return global.localStorage.getItem(CUR_KEY) || null; } catch (e) { return null; }
  }
  function setCurrentUserId(id) {
    try { id ? global.localStorage.setItem(CUR_KEY, id) : global.localStorage.removeItem(CUR_KEY); } catch (e) {}
  }
  async function currentUser() {
    var id = getCurrentUserId();
    if (!id) return null;
    var u = await DB.getUser(id);
    if (!u) { setCurrentUserId(null); return null; } // 데이터 초기화 등으로 사라진 경우 방어
    return u;
  }

  /* ------------------------------------------------- URL store 파라미터 */
  function readStoreParam() {
    try {
      var p = new URLSearchParams(global.location.search).get('store');
      return (typeof p === 'string' && p.trim()) ? p.trim() : null;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------- 유틸 */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d)) return '-';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
  }
  function fmtDateTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso); if (isNaN(d)) return '-';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function shortCode(id) { return String(id).slice(-6).toUpperCase(); }

  /* ------------------------------------------------- 토스트 / 모달 */
  function toast(msg, kind) {
    var host = document.getElementById('toastHost');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2200);
    setTimeout(function () { el.remove(); }, 2600);
  }

  function modal(opts) {
    var host = document.getElementById('modalHost');
    host.innerHTML =
      '<div class="modal ' + (opts.celebrate ? 'celebrate' : '') + '">' +
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
    document.getElementById('mConfirm').onclick = function () { close(); opts.onConfirm && opts.onConfirm(); };
    var c = document.getElementById('mCancel');
    if (c) c.onclick = function () { close(); opts.onCancel && opts.onCancel(); };
    host.onclick = function (e) { if (e.target === host && opts.cancel) { close(); opts.onCancel && opts.onCancel(); } };
    if (opts.afterOpen) opts.afterOpen(close);
  }

  /* =========================================================================
   * 렌더링
   * ====================================================================== */
  async function render() {
    var user = await currentUser();
    if (!user) { renderOnboard(); return; }
    renderMain(user);
  }

  /* ------------------------------------------------- 등록 화면 */
  function renderOnboard() {
    var app = document.getElementById('app');
    app.innerHTML =
      '<div class="onboard">' +
        '<div class="hero">' +
          '<div class="big-logo">🎫</div>' +
          '<h1>동네 한바퀴 스탬프</h1>' +
          '<p>매장에서 NFC를 태그하거나 QR을 스캔하면 참여 중인 적립 프로그램에<br/>스탬프가 쌓이고, 목표를 채우면 쿠폰이 자동 발급돼요.</p>' +
        '</div>' +
        '<div class="card">' +
          '<div class="field">' +
            '<label>이름 또는 닉네임</label>' +
            '<input class="input" id="obName" placeholder="이름을 입력하세요" maxlength="20" autocomplete="off" />' +
          '</div>' +
          '<div class="field">' +
            '<label>휴대폰 번호 뒤 4자리</label>' +
            '<input class="input" id="obPhone" placeholder="예: 1234" inputmode="numeric" maxlength="4" autocomplete="off" />' +
          '</div>' +
          '<button class="btn" id="obSubmit">시작하기</button>' +
          '<div class="hint">입력 정보는 이 기기에만 저장되며 자동 로그인됩니다.</div>' +
        '</div>' +
        '<div style="text-align:center"><button class="link-btn" id="goAdminFromOnboard">관리자 화면 →</button></div>' +
      '</div>';

    var nameEl = document.getElementById('obName');
    var phoneEl = document.getElementById('obPhone');
    phoneEl.addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 4); });
    document.getElementById('obSubmit').onclick = async function () {
      var btn = document.getElementById('obSubmit');
      btn.disabled = true;
      var res;
      try { res = await DB.createUser(nameEl.value, phoneEl.value); }
      catch (e) { toast('네트워크 오류가 발생했어요. 다시 시도해 주세요.', 'err'); btn.disabled = false; return; }
      if (!res.ok) { toast(res.message, 'warn'); btn.disabled = false; return; }
      setCurrentUserId(res.user.id);
      toast('환영합니다, ' + res.user.name + '님!', 'ok');
      render();
    };
    phoneEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') document.getElementById('obSubmit').click(); });
    document.getElementById('goAdminFromOnboard').onclick = gotoAdmin;
  }

  /* ------------------------------------------------- 메인 화면 */
  async function renderMain(user) {
    var app = document.getElementById('app');
    var coupons = await DB.getCoupons(user.id);
    var availCount = coupons.filter(function (c) { return c.status === 'available'; }).length;

    app.innerHTML =
      '<header class="appbar">' +
        '<div class="brand"><div class="logo">한</div><div class="title">동네 한바퀴</div></div>' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<div class="who">👤 <b>' + esc(user.name) + '</b></div>' +
          '<button class="link-btn" id="btnManage">관리</button>' +
        '</div>' +
      '</header>' +
      '<div class="screen">' +
        '<section class="view" id="view-home"></section>' +
        '<section class="view" id="view-discover"></section>' +
        '<section class="view" id="view-history"></section>' +
        '<section class="view" id="view-coupons"></section>' +
      '</div>' +
      '<nav class="tabbar">' +
        tabBtn('home', '🏠', '홈') +
        tabBtn('discover', '🔍', '프로그램 찾기') +
        tabBtn('history', '📜', '적립 내역') +
        tabBtn('coupons', '🎟️', '쿠폰함', availCount) +
      '</nav>';

    document.getElementById('btnManage').onclick = openUserMenu;
    ['home', 'discover', 'history', 'coupons'].forEach(function (t) {
      document.getElementById('tab-' + t).onclick = function () { switchTab(t); };
    });

    await renderHome(user);
    await renderDiscover(user);
    await renderHistory(user);
    await renderCoupons(user);
    switchTab(state.tab);
  }

  function tabBtn(key, icon, label, badge) {
    var b = (badge && badge > 0) ? '<span class="dot">' + badge + '</span>' : '';
    return '<div class="tab-wrap"><button id="tab-' + key + '"><span class="ti">' + icon + '</span>' + label + b + '</button></div>';
  }

  function switchTab(t) {
    state.tab = t;
    ['home', 'discover', 'history', 'coupons'].forEach(function (k) {
      var v = document.getElementById('view-' + k);
      var b = document.getElementById('tab-' + k);
      if (v) v.classList.toggle('active', k === t);
      if (b) b.classList.toggle('active', k === t);
    });
    var scr = document.querySelector('.screen'); if (scr) scr.scrollTop = 0;
  }

  /* ------------------------------------------------- 홈(내 적립판 + 매장 배너) */
  async function renderHome(user) {
    var v = document.getElementById('view-home');
    var html = '';

    // 도장 받기 CTA (QR 스캔 / NFC 태그 선택) — 홈의 메인 액션
    html += '<div class="card collect-cta hero">' +
        '<div class="cta-icon">📍</div>' +
        '<button class="btn" id="btnCollect">도장 받기</button>' +
        '<div class="sub">QR 스캔 또는 NFC 태그로 매장 도장을 적립하세요</div>' +
      '</div>';

    // 매장 접속 배너 (?store=xxx)
    if (state.storeParam) {
      html += await storeBannerHTML(user);
    }

    // 내 적립판 (참여한 프로그램별)
    var wallets = await DB.getProgramWallets(user.id);
    html += '<div class="section-title">내 적립판 (' + wallets.length + ')</div>';
    if (wallets.length === 0) {
      html += '<div class="card"><div class="empty"><div class="em">🗂️</div>아직 참여한 적립 프로그램이 없어요.<br/>아래 “프로그램 찾기” 탭에서 참여해보세요!</div></div>';
    } else {
      wallets.forEach(function (w) { html += programWalletCardHTML(w); });
    }

    // 최근 적립 내역 (요약)
    var recent = (await DB.getStampEvents(user.id)).slice(0, 4);
    html += '<div class="section-title">최근 적립</div><div class="card">';
    if (recent.length === 0) {
      html += '<div class="empty" style="padding:22px"><div class="em">🧾</div>아직 적립 내역이 없어요.<br/>위 “도장 받기”로 QR을 스캔하거나 NFC를 태그해 보세요!</div>';
    } else {
      for (var i = 0; i < recent.length; i++) {
        var e = recent[i];
        var st = await DB.getStore(e.storeId);
        html += rowHTML('☕', (st ? st.name : '알 수 없는 매장'),
          fmtDateTime(e.stampedAt), '적립 후 ' + e.stampCountAfter + '개');
      }
    }
    html += '</div>';

    v.innerHTML = html;

    // 매장 배너 버튼 연결
    var stampBtn = document.getElementById('btnStamp');
    if (stampBtn) stampBtn.onclick = function () { doStamp(user); };
    // 도장 받기(QR/NFC) 버튼 연결
    var collectBtn = document.getElementById('btnCollect');
    if (collectBtn) collectBtn.onclick = function () { openCollect(user); };
    // 매장 배너에서 프로그램 참여 버튼
    v.querySelectorAll('[data-join]').forEach(function (b) {
      b.onclick = function () { joinAndRefresh(user, b.getAttribute('data-join'), b); };
    });
  }

  async function joinAndRefresh(user, programId, btn) {
    if (btn) btn.disabled = true;
    var res;
    try { res = await DB.joinProgram(user.id, programId); }
    catch (e) { toast('네트워크 오류가 발생했어요.', 'err'); if (btn) btn.disabled = false; return; }
    if (!res.ok) { toast(res.message, 'err'); if (btn) btn.disabled = false; return; }
    toast('프로그램에 참여했어요!', 'ok');
    await renderHome(user);
    await renderDiscover(user);
  }

  function programWalletCardHTML(w) {
    var tiers = w.tiers || [];
    var maxTier = tiers.length ? tiers[tiers.length - 1].threshold : Math.max(w.currentCount, 10);
    var pct = Math.min(100, Math.round((w.currentCount / maxTier) * 100));
    var scopeBadge = w.scope === 'alliance' ? '<span class="badge apri">공동적립</span>' : '<span class="badge blue">단일매장</span>';
    var tiersHTML = tiers.map(function (t) {
      var done = w.issuedTierThresholds.indexOf(t.threshold) !== -1;
      var reached = w.currentCount >= t.threshold;
      return '<div class="tier-chip ' + (done ? 'done' : (reached ? 'ready' : '')) + '">' +
        (done ? '✅ ' : '') + t.threshold + '개 · ' + esc(t.couponTitle) + '</div>';
    }).join('');
    return '<div class="card program-wallet">' +
        '<div class="wallet-head">' +
          '<div class="tt" style="font-weight:700">' + esc(w.programName) + ' ' + scopeBadge + '</div>' +
          '<div class="count"><b>' + w.currentCount + '</b>개</div>' +
        '</div>' +
        '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
        '<div class="tiers-list">' + tiersHTML + '</div>' +
      '</div>';
  }

  /* ------------------------------------------------- 프로그램 찾기(참여) 화면 */
  async function renderDiscover(user) {
    var v = document.getElementById('view-discover');
    var [programs, joinedIds, stores] = await Promise.all([
      DB.getPrograms(), DB.getUserProgramIds(user.id), DB.getStores()
    ]);
    var storeById = {};
    stores.forEach(function (s) { storeById[s.id] = s; });
    var active = programs.filter(function (p) { return p.active; });

    var html = '<div class="section-title">참여 가능한 적립 프로그램 (' + active.length + ')</div>';
    if (active.length === 0) {
      html += '<div class="card"><div class="empty"><div class="em">🗂️</div>운영 중인 프로그램이 없어요.</div></div>';
    } else {
      active.forEach(function (p) {
        var joined = joinedIds.indexOf(p.id) !== -1;
        var storeNames = p.storeIds.map(function (id) { return storeById[id] ? storeById[id].name : id; }).join(', ');
        var scopeBadge = p.scope === 'alliance' ? '<span class="badge apri">공동적립</span>' : '<span class="badge blue">단일매장</span>';
        var tiersHTML = p.tiers.map(function (t) { return '<div class="tier-chip">' + t.threshold + '개 · ' + esc(t.couponTitle) + '</div>'; }).join('');
        html += '<div class="card program-card">' +
            '<div class="wallet-head">' +
              '<div class="tt" style="font-weight:700">' + esc(p.name) + ' ' + scopeBadge + (joined ? ' <span class="badge joined">참여 중</span>' : '') + '</div>' +
            '</div>' +
            (p.description ? '<div class="desc">' + esc(p.description) + '</div>' : '') +
            '<div class="stores">대상 매장: ' + esc(storeNames || '-') + '</div>' +
            '<div class="tiers-list">' + tiersHTML + '</div>' +
            '<div class="join-row">' +
              (joined
                ? '<button class="btn ghost sm" disabled>참여 중</button>'
                : '<button class="btn accent sm" data-join="' + p.id + '">참여하기</button>') +
            '</div>' +
          '</div>';
      });
    }
    v.innerHTML = html;
    v.querySelectorAll('[data-join]').forEach(function (b) {
      b.onclick = function () { joinAndRefresh(user, b.getAttribute('data-join'), b); };
    });
  }

  async function storeBannerHTML(user) {
    var store = await DB.getStore(state.storeParam);
    if (!store) {
      return '<div class="card store-error">' +
        '<div class="badge red">⚠️ 확인 필요</div>' +
        '<h2 style="margin:8px 0 4px;font-size:18px">등록되지 않은 매장입니다</h2>' +
        '<div style="color:var(--text-2);font-size:13px">매장 코드 <b>' + esc(state.storeParam) + '</b> 를 찾을 수 없어요.</div>' +
      '</div>';
    }
    if (!store.active) {
      return '<div class="card store-error">' +
        '<div class="badge gray">운영 중지</div>' +
        '<h2 style="margin:8px 0 4px;font-size:18px">' + esc(store.name) + '</h2>' +
        '<div style="color:var(--text-2);font-size:13px">현재 운영이 중지된 매장이라 적립할 수 없어요.</div>' +
      '</div>';
    }

    var [programs, joinedIds] = await Promise.all([DB.getPrograms(), DB.getUserProgramIds(user.id)]);
    var atStore = programs.filter(function (p) { return p.active && p.storeIds.indexOf(store.id) !== -1; });
    var joinedHere = atStore.filter(function (p) { return joinedIds.indexOf(p.id) !== -1; });
    var notJoinedHere = atStore.filter(function (p) { return joinedIds.indexOf(p.id) === -1; });

    var html = '<div class="card store-banner">' +
        '<div class="eyebrow">📍 매장 접속 · NFC / QR</div>' +
        '<h2>' + esc(store.name) + '</h2>' +
        '<div class="cat">' + esc(store.category) + ' · ' + esc(store.id) + '</div>';

    if (atStore.length === 0) {
      html += '<div class="hint">이 매장에서 운영 중인 적립 프로그램이 없어요.</div>';
    } else {
      if (joinedHere.length > 0) {
        html += '<button class="btn" id="btnStamp">스탬프 적립하기</button>' +
          '<div class="hint">참여 중: ' + joinedHere.map(function (p) { return esc(p.name); }).join(', ') + '</div>';
      }
      if (notJoinedHere.length > 0) {
        html += '<div class="section-title" style="margin-top:12px">이 매장의 참여 가능한 프로그램</div>';
        notJoinedHere.forEach(function (p) {
          html += '<div class="join-prompt-row">' +
              '<div><div class="name">' + esc(p.name) + '</div><div class="sub">' + esc(p.description || '') + '</div></div>' +
              '<button class="btn accent sm" data-join="' + p.id + '">참여하기</button>' +
            '</div>';
        });
      }
    }
    html += '</div>';
    return html;
  }

  /* ------------------------------------------------- 스탬프 적립 실행(공통) */
  async function commitStamp(user, storeId) {
    if (state.busy) return { ok: false, code: 'BUSY' };
    var now = Date.now();
    if (now - state.lastStampAt < 800) return { ok: false, code: 'BUSY' }; // 중복 실행 방지
    state.lastStampAt = now;
    state.busy = true;

    var res;
    try { res = await DB.addStamp(user.id, storeId); }
    catch (e) { toast('네트워크 오류가 발생했어요. 다시 시도해 주세요.', 'err'); state.busy = false; return { ok: false, code: 'ERROR' }; }

    if (!res.ok) {
      toast(res.message, (res.code === 'COOLDOWN' || res.code === 'NO_PROGRAM') ? 'warn' : 'err');
      state.busy = false;
      return res;
    }

    // 적립 성공 → 모든 뷰 갱신
    await renderHome(user);
    await renderHistory(user);
    await renderCoupons(user);
    await updateCouponBadge(user);

    var issuedCoupons = res.results.filter(function (r) { return r.coupon; }).map(function (r) { return r.coupon; });
    if (issuedCoupons.length > 0) {
      modal({
        celebrate: true, emoji: '🎉',
        title: issuedCoupons.length > 1 ? '쿠폰이 ' + issuedCoupons.length + '개 발급되었어요!' : '쿠폰이 발급되었어요!',
        desc: issuedCoupons.map(function (c) { return '<b>' + esc(c.title) + '</b>'; }).join('<br/>') + '<br/>쿠폰함에서 확인하세요.',
        confirm: '쿠폰함 보기', confirmClass: 'accent',
        cancel: '닫기',
        onConfirm: function () { switchTab('coupons'); }
      });
    } else {
      var summary = res.results.map(function (r) { return r.programName + ' ' + r.currentCount + '개'; }).join(' · ');
      toast((res.store.name || '매장') + ' 도장 적립! ' + summary, 'ok');
    }

    setTimeout(function () { state.busy = false; }, 400);
    return res;
  }

  // 매장 배너의 "스탬프 적립하기" 버튼
  async function doStamp(user) {
    var btn = document.getElementById('btnStamp');
    if (btn) btn.disabled = true;
    var res = await commitStamp(user, state.storeParam);
    if (btn && (!res || !res.ok)) btn.disabled = false;
  }

  /* ------------------------------------------------- 도장 받기 (QR / NFC 선택) */
  function openCollect(user) {
    var nfcOK = !!(global.Scan && Scan.supportsNFC());
    modal({
      emoji: '📍', title: '도장 받기', desc: '어떻게 적립할까요?',
      formHTML:
        '<div class="choice-list">' +
          '<button class="choice-btn primary" id="cQR" type="button">' +
            '<span class="cic">📷</span><span><span class="ct">QR 스캔으로 적립</span>' +
            '<span class="cs">매장 QR을 카메라로 스캔</span></span></button>' +
          '<button class="choice-btn apri" id="cNFC" type="button">' +
            '<span class="cic">📡</span><span><span class="ct">NFC 태그로 적립</span>' +
            '<span class="cs">' + (nfcOK ? '폰을 매장 NFC 태그에 대기' : '이 기기는 앱 내 NFC 미지원') + '</span></span></button>' +
        '</div>',
      confirm: '닫기', confirmClass: 'ghost',
      afterOpen: function (close) {
        document.getElementById('cQR').onclick = function () { close(); collectQR(user); };
        document.getElementById('cNFC').onclick = function () { close(); collectNFC(user); };
      }
    });
  }

  function collectQR(user) {
    if (!global.Scan) { toast('스캔 모듈을 불러오지 못했어요.', 'err'); return; }
    Scan.scanQR().then(function (r) {
      commitStamp(user, r.store);
    }).catch(function (e) {
      if (e && e.code === 'CANCEL') return;
      toast((e && e.message) || 'QR 스캔에 실패했어요.', 'warn');
    });
  }


  function collectNFC(user) {
    if (!global.Scan) { toast('스캔 모듈을 불러오지 못했어요.', 'err'); return; }
    if (!Scan.supportsNFC()) {
      modal({
        emoji: '📡', title: 'NFC 미지원',
        desc: '이 기기/브라우저는 앱 내 NFC 읽기를 지원하지 않아요.<br/>(안드로이드 크롬에서 지원)<br/><br/>QR로 적립하거나, 매장 NFC 태그를 폰에 태그하면 적립 화면이 열립니다.',
        confirm: '확인'
      });
      return;
    }
    Scan.readNFC().then(function (r) {
      commitStamp(user, r.store);
    }).catch(function (e) {
      if (e && e.code === 'CANCEL') return;
      toast((e && e.message) || 'NFC 읽기에 실패했어요.', 'warn');
    });
  }

  async function updateCouponBadge(user) {
    var coupons = await DB.getCoupons(user.id);
    var avail = coupons.filter(function (c) { return c.status === 'available'; }).length;
    var wrap = document.querySelector('#tab-coupons');
    if (!wrap) return;
    var old = wrap.querySelector('.dot'); if (old) old.remove();
    if (avail > 0) {
      var d = document.createElement('span'); d.className = 'dot'; d.textContent = avail; wrap.appendChild(d);
    }
  }

  /* ------------------------------------------------- 적립 내역 화면 */
  async function renderHistory(user) {
    var v = document.getElementById('view-history');
    var events = await DB.getStampEvents(user.id);
    var html = '<div class="section-title">전체 적립 내역 (' + events.length + '건)</div><div class="card">';
    if (events.length === 0) {
      html += '<div class="empty"><div class="em">📜</div>적립 내역이 없습니다.</div>';
    } else {
      for (var i = 0; i < events.length; i++) {
        var e = events[i];
        var st = await DB.getStore(e.storeId);
        html += rowHTML('☕', (st ? st.name : '알 수 없는 매장'),
          fmtDateTime(e.stampedAt), '적립 후 ' + e.stampCountAfter + '개');
      }
    }
    html += '</div>';
    v.innerHTML = html;
  }

  /* ------------------------------------------------- 쿠폰함 화면 */
  async function renderCoupons(user) {
    var v = document.getElementById('view-coupons');
    var [coupons, programs] = await Promise.all([DB.getCoupons(user.id), DB.getPrograms()]);
    var programById = {};
    programs.forEach(function (p) { programById[p.id] = p; });
    var avail = coupons.filter(function (c) { return c.status === 'available'; });
    var others = coupons.filter(function (c) { return c.status !== 'available'; });

    var html = '';
    html += '<div class="section-title">사용 가능한 쿠폰 (' + avail.length + ')</div>';
    if (avail.length === 0) {
      html += '<div class="card"><div class="empty"><div class="em">🎟️</div>사용 가능한 쿠폰이 없어요.<br/>프로그램에 참여해 스탬프를 모아보세요!</div></div>';
    } else {
      avail.forEach(function (c) { html += couponHTML(c, programById[c.programId]); });
    }

    if (others.length) {
      html += '<div class="section-title" style="margin-top:16px">지난 쿠폰 (' + others.length + ')</div>';
      others.forEach(function (c) { html += couponHTML(c, programById[c.programId]); });
    }
    html += '<div class="hint" style="text-align:center;margin-top:14px">쿠폰 사용 처리는 매장 관리자 화면에서만 가능합니다.</div>';
    v.innerHTML = html;
  }

  function couponHTML(c, program) {
    var statusBadge =
      c.status === 'available' ? '<span class="badge apri">사용 가능</span>' :
      c.status === 'used'      ? '<span class="badge gray">사용 완료</span>' :
                                 '<span class="badge red">기간 만료</span>';
    var usedInfo = c.status === 'used' ? ' · 사용일 ' + fmtDate(c.usedAt) : '';
    var programInfo = program ? (esc(program.name) + (c.tierThreshold ? ' · ' + c.tierThreshold + '개 달성 보상' : '')) : '';
    return '<div class="coupon ' + c.status + '">' +
        '<div class="top">' +
          '<div class="gift">🎁</div>' +
          '<div><div class="t">' + esc(c.title) + '</div><div class="b">' + esc(c.benefit) + '</div></div>' +
        '</div>' +
        '<div class="perf"></div>' +
        '<div class="body">' +
          '<div class="meta">' +
            (programInfo ? programInfo + '<br/>' : '') +
            '유효기간 ~ ' + fmtDate(c.expiresAt) + usedInfo + '<br/>' +
            '쿠폰번호 <span class="code">' + shortCode(c.id) + '</span>' +
          '</div>' +
          statusBadge +
        '</div>' +
      '</div>';
  }

  function rowHTML(icon, title, sub, end) {
    return '<div class="row">' +
        '<div class="ic">' + icon + '</div>' +
        '<div class="main"><div class="t">' + esc(title) + '</div><div class="s">' + esc(sub) + '</div></div>' +
        '<div class="end">' + esc(end) + '</div>' +
      '</div>';
  }

  /* ------------------------------------------------- 사용자 메뉴(변경/초기화) */
  function openUserMenu() {
    modal({
      emoji: '⚙️', title: '사용자 메뉴',
      desc: '사용자를 변경하거나 관리자 화면으로 이동할 수 있어요.',
      confirm: '관리자 화면', confirmClass: 'secondary',
      cancel: '닫기',
      onConfirm: gotoAdmin
    });
    // 모달에 사용자 변경 버튼 추가
    var actions = document.querySelector('#modalHost .m-actions');
    if (actions) {
      var b = document.createElement('button');
      b.className = 'btn ghost'; b.textContent = '사용자 변경';
      b.style.flex = '1';
      b.onclick = function () {
        document.getElementById('modalHost').classList.remove('open');
        document.getElementById('modalHost').innerHTML = '';
        confirmChangeUser();
      };
      actions.insertBefore(b, actions.firstChild);
    }
  }

  function confirmChangeUser() {
    modal({
      emoji: '🔄', title: '사용자 변경',
      desc: '현재 기기의 로그인을 해제하고 새로 등록합니다.<br/>적립·쿠폰 데이터는 삭제되지 않아요.',
      confirm: '변경하기', confirmClass: 'accent', cancel: '취소',
      onConfirm: function () { setCurrentUserId(null); state.tab = 'home'; render(); }
    });
  }

  function gotoAdmin() {
    if (global.__routes && global.__routes.toAdmin) return global.__routes.toAdmin();
    global.location.href = 'admin.html';
  }

  /* =========================================================================
   * 진입점
   * ====================================================================== */
  async function initUserApp() {
    await DB.init();
    state.storeParam = readStoreParam();
    try {
      await render();
    } catch (e) {
      console.error('[App] 초기 로딩 실패', e);
      var app = document.getElementById('app');
      if (app) {
        app.innerHTML = '<div class="onboard"><div class="card"><div class="empty">' +
          '<div class="em">⚠️</div>서버에 연결하지 못했어요.<br/>' +
          'supabase-config.js 설정을 확인하거나 잠시 후 새로고침 해주세요.</div></div></div>';
      }
    }
  }

  global.initUserApp = initUserApp;
  global.__userApp = { render: render }; // 라우터/디버그용

})(typeof window !== 'undefined' ? window : globalThis);
