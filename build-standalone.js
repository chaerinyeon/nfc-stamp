/* build-standalone.js
 * 유지보수용 멀티파일(styles.css/db.js/app.js/admin.js)을 하나의 HTML로 합쳐
 * 라이브 데모/NFC 실물 테스트용 단일 파일(app-standalone.html)을 생성합니다.
 * 사용자/관리자 전환은 URL 해시(#admin)로 라우팅합니다.
 */
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const css = read('styles.css');
const supabaseConfig = read('supabase-config.js');
const db = read('db.js');
const app = read('app.js');
const admin = read('admin.js');
const qrlib = read('vendor/qrcode.min.js');
const qr = read('qr.js');
const jsqrlib = read('vendor/jsqr.min.js');
const scan = read('scan.js');

const router = `
/* ---- 단일파일 라우터 (해시 기반) ---- */
(function () {
  function boot() {
    if (location.hash === '#admin') { window.initAdminApp(); }
    else { window.initUserApp(); }
  }
  window.__routes = {
    toUser: function () { history.pushState(null, '', location.pathname + location.search); boot(); },
    toAdmin: function () { history.pushState(null, '', location.pathname + location.search + '#admin'); boot(); }
  };
  window.addEventListener('hashchange', boot);
  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
`;

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#F5F0E4" />
<title>동네 한바퀴 · NFC 쿠폰 도장</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
${css}
</style>
</head>
<body>
<div class="app" id="app"></div>
<div class="toast-host" id="toastHost"></div>
<div class="modal-host" id="modalHost"></div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
${supabaseConfig}
</script>
<script>
${db}
</script>
<script>
${qrlib}
</script>
<script>
${qr}
</script>
<script>
${jsqrlib}
</script>
<script>
${scan}
</script>
<script>
${app}
</script>
<script>
${admin}
</script>
<script>
${router}
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(dir, 'app-standalone.html'), html, 'utf8');
console.log('✓ app-standalone.html 생성 완료 (' + html.length + ' bytes)');
