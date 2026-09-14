/* =============================================================================
 * scan.js — 인앱 적립 입력: QR 카메라 스캔 + Web NFC 읽기
 * 매장 QR/NFC에 담긴 URL에서 store 값을 읽어 반환합니다. (적립 자체는 app.js가 처리)
 *   - QR: 폰 카메라 + jsQR (window.jsQR)
 *   - NFC: Web NFC(NDEFReader) — 안드로이드 크롬 등 지원 기기에서만
 * ========================================================================== */
(function (global) {
  'use strict';

  var doc = global.document;

  /* store 파라미터 파싱 (URL이든 'store_001' 같은 원문이든 안전 처리) */
  function parseStore(text) {
    if (!text) return null;
    text = String(text).trim();
    // 1) 정식 URL
    try {
      var u = new URL(text);
      var s = u.searchParams.get('store');
      if (s) return s.trim();
    } catch (e) { /* URL 아님 */ }
    // 2) ?store=/&store= 패턴
    var m = text.match(/[?&]store=([^&\s#]+)/);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    // 3) store_xxx 형태만 있는 경우
    var m2 = text.match(/\bstore[_-]?\w+/i);
    if (m2) return m2[0];
    return null;
  }

  function supportsNFC() { return typeof global.NDEFReader !== 'undefined'; }
  function supportsCamera() {
    return !!(global.navigator && global.navigator.mediaDevices && global.navigator.mediaDevices.getUserMedia && global.jsQR);
  }
  function isSecure() { return global.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'; }

  /* ------------------------------------------------- 오버레이 UI 헬퍼 */
  function makeOverlay(inner) {
    var el = doc.createElement('div');
    el.className = 'scanner';
    el.innerHTML = inner;
    doc.body.appendChild(el);
    return el;
  }

  /* ------------------------------------------------- QR 카메라 스캔 */
  function scanQR() {
    return new Promise(function (resolve, reject) {
      if (!isSecure()) return reject({ code: 'INSECURE', message: 'QR 카메라는 https 환경에서만 동작해요.' });
      if (!supportsCamera()) return reject({ code: 'NO_CAMERA', message: '이 기기/브라우저에서는 카메라 QR 스캔을 지원하지 않아요.' });

      var overlay = makeOverlay(
        '<div class="scan-top"><span>📷 QR 스캔</span><button class="scan-close" id="scanClose">✕</button></div>' +
        '<video class="scan-video" id="scanVideo" playsinline muted></video>' +
        '<div class="scan-frame"></div>' +
        '<div class="scan-hint">매장 QR을 사각형 안에 맞춰주세요</div>'
      );
      var video = overlay.querySelector('#scanVideo');
      var canvas = doc.createElement('canvas');
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      var stream = null, raf = null, done = false;

      function cleanup() {
        done = true;
        if (raf) global.cancelAnimationFrame(raf);
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
      overlay.querySelector('#scanClose').onclick = function () { if (done) return; cleanup(); reject({ code: 'CANCEL' }); };

      global.navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        .then(function (s) {
          stream = s; video.srcObject = s;
          video.setAttribute('playsinline', '');
          return video.play();
        })
        .then(function () { raf = global.requestAnimationFrame(tick); })
        .catch(function (err) {
          cleanup();
          var code = (err && err.name === 'NotAllowedError') ? 'PERMISSION' : 'CAMERA_FAIL';
          reject({ code: code, message: code === 'PERMISSION' ? '카메라 권한을 허용해 주세요.' : '카메라를 열 수 없어요.' });
        });

      function tick() {
        if (done) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          var img;
          try { img = ctx.getImageData(0, 0, canvas.width, canvas.height); }
          catch (e) { raf = global.requestAnimationFrame(tick); return; }
          var result = global.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (result && result.data) {
            var store = parseStore(result.data);
            if (store) { cleanup(); resolve({ text: result.data, store: store }); return; }
            // QR은 읽혔지만 매장 정보가 없음 → 계속 스캔
          }
        }
        raf = global.requestAnimationFrame(tick);
      }
    });
  }

  /* ------------------------------------------------- Web NFC 읽기 */
  function readNFC() {
    return new Promise(function (resolve, reject) {
      if (!supportsNFC()) return reject({ code: 'NFC_UNSUPPORTED', message: '이 기기/브라우저는 앱 내 NFC 읽기를 지원하지 않아요. (안드로이드 크롬에서 지원)' });
      if (!isSecure()) return reject({ code: 'INSECURE', message: 'NFC는 https 환경에서만 동작해요.' });

      var overlay = makeOverlay(
        '<div class="scan-top"><span>📡 NFC 태그</span><button class="scan-close" id="nfcClose">✕</button></div>' +
        '<div class="nfc-wait"><div class="nfc-pulse">📡</div><div class="nfc-msg">폰 뒷면을 매장 NFC 태그에 가까이 대주세요</div></div>'
      );
      var done = false, ac = new (global.AbortController || function () { this.abort = function () {}; })();
      function cleanup() { done = true; try { ac.abort(); } catch (e) {} if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); }
      overlay.querySelector('#nfcClose').onclick = function () { if (done) return; cleanup(); reject({ code: 'CANCEL' }); };

      var reader;
      try { reader = new global.NDEFReader(); } catch (e) { cleanup(); return reject({ code: 'NFC_FAIL', message: 'NFC를 시작할 수 없어요.' }); }

      reader.onreading = function (event) {
        if (done) return;
        var text = null;
        try {
          var records = (event.message && event.message.records) || [];
          for (var i = 0; i < records.length; i++) {
            var rec = records[i];
            if (rec.recordType === 'url' || rec.recordType === 'absolute-url') {
              text = new TextDecoder().decode(rec.data); break;
            }
            if (rec.recordType === 'text') {
              var enc = rec.encoding || 'utf-8';
              text = new TextDecoder(enc).decode(rec.data); break;
            }
          }
        } catch (e) {}
        var store = parseStore(text);
        if (store) { cleanup(); resolve({ text: text, store: store }); }
        // 매장 정보 없는 태그면 계속 대기
      };
      reader.onreadingerror = function () { /* 인식 실패 → 계속 대기 */ };

      reader.scan({ signal: ac.signal }).catch(function (err) {
        if (done) return;
        cleanup();
        var code = (err && err.name === 'NotAllowedError') ? 'PERMISSION' : 'NFC_FAIL';
        reject({ code: code, message: code === 'PERMISSION' ? 'NFC 권한을 허용해 주세요.' : 'NFC 스캔을 시작할 수 없어요.' });
      });
    });
  }

  global.Scan = {
    parseStore: parseStore,
    supportsNFC: supportsNFC,
    supportsCamera: supportsCamera,
    isSecure: isSecure,
    scanQR: scanQR,
    readNFC: readNFC
  };

})(typeof window !== 'undefined' ? window : globalThis);
