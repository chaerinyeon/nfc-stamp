/* =============================================================================
 * qr.js — QR 코드 생성 래퍼
 * 매장 URL(NFC와 동일한 ?store= URL)을 QR 코드로 만들어 화면 표시 / PNG 저장 / 인쇄.
 * 전역 qrcode (vendor/qrcode.min.js, MIT, 무의존)를 감쌉니다.
 * ========================================================================== */
(function (global) {
  'use strict';

  var _utf8Set = false;
  function ensureUTF8() {
    if (_utf8Set) return;
    try {
      if (global.qrcode && global.qrcode.stringToBytesFuncs && global.qrcode.stringToBytesFuncs['UTF-8']) {
        global.qrcode.stringToBytes = global.qrcode.stringToBytesFuncs['UTF-8']; // 한글 등 모든 URL 안전 인코딩
      }
    } catch (e) {}
    _utf8Set = true;
  }

  function make(text) {
    ensureUTF8();
    var qr = global.qrcode(0, 'M');      // typeNumber 0 = 자동, 오류보정 M
    qr.addData(String(text == null ? '' : text));
    qr.make();
    return qr;
  }

  // 모듈을 직접 캔버스에 그려 어떤 크기에서도 선명한(픽셀 정렬) QR 생성
  function toCanvas(text, px) {
    var qr = make(text);
    var count = qr.getModuleCount();
    var margin = 4;                       // 조용한 영역(quiet zone) 4모듈
    var total = count + margin * 2;
    var scale = Math.max(2, Math.floor((px || 512) / total));
    var size = total * scale;
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';            // 스캔 신뢰도를 위해 순수 흑백
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
        }
      }
    }
    return cv;
  }

  function toPngDataURL(text, px) {
    try { return toCanvas(text, px).toDataURL('image/png'); }
    catch (e) { return null; }
  }

  // PNG 저장 (자체 호스팅 환경에서 동작. 일부 미리보기/샌드박스에서는 제한될 수 있음)
  function downloadPng(text, filename, px) {
    var url = toPngDataURL(text, px || 720);
    if (!url) return false;
    try {
      var a = document.createElement('a');
      a.href = url; a.download = (filename || 'qr') + '.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      return true;
    } catch (e) { return false; }
  }

  // 인쇄 (새 창에 QR + 매장명 + URL)
  function printQR(text, title, subtitle) {
    var url = toPngDataURL(text, 720);
    if (!url) return false;
    var w = global.open('', '_blank', 'width=480,height=640');
    if (!w) return false;
    w.document.write(
      '<html><head><meta charset="utf-8"><title>' + escapeHtml(title || 'QR') + '</title>' +
      '<style>body{font-family:sans-serif;text-align:center;padding:32px;color:#23262e}' +
      'h1{font-size:22px;margin:0 0 4px}p{color:#6a6e79;font-size:13px;word-break:break-all;margin:0 0 20px}' +
      'img{width:320px;height:320px;image-rendering:pixelated;border:1px solid #eee;padding:12px;border-radius:12px}' +
      '.tag{margin-top:16px;font-size:13px;color:#2743d4;font-weight:700}</style></head><body>' +
      '<h1>' + escapeHtml(title || '') + '</h1>' +
      '<p>' + escapeHtml(subtitle || '') + '</p>' +
      '<img src="' + url + '" alt="QR" />' +
      '<div class="tag">📷 카메라로 스캔하면 스탬프가 적립됩니다</div>' +
      '</body></html>'
    );
    w.document.close();
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 250);
    return true;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  global.QR = {
    toCanvas: toCanvas,
    toPngDataURL: toPngDataURL,
    downloadPng: downloadPng,
    printQR: printQR
  };

})(typeof window !== 'undefined' ? window : globalThis);
