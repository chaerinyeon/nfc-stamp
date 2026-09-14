const fs=require('fs'),p=require('path'),d=__dirname,r=f=>fs.readFileSync(p.join(d,f),'utf8');
const css=r('styles.css'),supabaseConfig=r('supabase-config.js'),db=r('db.js'),app=r('app.js'),admin=r('admin.js');
const qrlib=r('vendor/qrcode.min.js'),qr=r('qr.js'),jsqrlib=r('vendor/jsqr.min.js'),scan=r('scan.js');
const router=`(function(){function boot(){if(location.hash==='#admin'){window.initAdminApp();}else{window.initUserApp();}}
window.__routes={toUser:function(){history.pushState(null,'',location.pathname+location.search);boot();},
toAdmin:function(){history.pushState(null,'',location.pathname+location.search+'#admin');boot();}};
window.addEventListener('hashchange',boot);if(document.readyState!=='loading')boot();else document.addEventListener('DOMContentLoaded',boot);})();`;
const S=s=>'<script>\n'+s+'\n</'+'script>';
const out=`<title>동네 한바퀴 스탬프</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
${css}
</style>
<div class="app" id="app"></div>
<div class="toast-host" id="toastHost"></div>
<div class="modal-host" id="modalHost"></div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
${S(supabaseConfig)}
${S(db)}
${S(qrlib)}
${S(qr)}
${S(jsqrlib)}
${S(scan)}
${S(app)}
${S(admin)}
${S(router)}
`;
fs.writeFileSync(p.join(d,'artifact.html'),out,'utf8');
console.log('artifact.html',out.length,'bytes');
