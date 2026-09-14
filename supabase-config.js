/* supabase-config.js
 * Supabase 프로젝트 설정. Supabase 대시보드 → Project Settings → API 에서
 * "Project URL" 과 "anon public" 키를 복사해 아래 값을 교체하세요.
 * anon 키는 공개 클라이언트에 그대로 노출되는 용도로 설계된 키이며,
 * 실제 접근 제어는 서버(RLS + supabase/schema.sql의 함수)가 담당합니다.
 */
window.SUPABASE_CONFIG = {
  url: 'https://YOUR_PROJECT_REF.supabase.co',
  anonKey: 'YOUR_SUPABASE_ANON_KEY'
};
