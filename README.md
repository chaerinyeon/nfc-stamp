# NFC · QR 쿠폰 도장 앱 (동네 한바퀴)

종이 쿠폰 대신 **스마트폰 NFC 태그 또는 QR 스캔**으로 스탬프를 적립하는 디지털 멤버십 웹앱입니다.
NFC와 QR은 **똑같은 매장별 URL**(`?store=매장ID`)을 사용합니다. 태그를 탭하거나 QR을 카메라로 스캔하면 그 URL이 열리고, 스탬프가 1개 적립됩니다.
목표(기본 10개)를 채우면 쿠폰이 **자동 발급**되고, 매장 관리자가 쿠폰을 사용 처리합니다.

**실제 매장·손님 배포용 버전**입니다. 데이터는 [Supabase](https://supabase.com)(Postgres) 서버에 저장되어
여러 매장·여러 손님의 기기가 실시간으로 데이터를 공유합니다. 결제·위치 인증·푸시 알림은 범위에서 제외했습니다.

---

## 핵심 흐름

```
사용자 등록 → 매장 NFC 태그 또는 QR 스캔 → ?store=매장ID URL 접속 → 스탬프 1개 적립
→ 공동 적립판 확인 → 목표 달성 → 쿠폰 자동 발급 → 쿠폰함 확인
→ 매장에서 쿠폰 제시 → 관리자가 사용 완료 처리
```

여러 제휴 매장의 스탬프가 **하나의 공동 적립판**에 함께 모입니다.

---

## 배포 전 필수 설정 (최초 1회)

이 앱은 백엔드로 **Supabase**를 사용합니다. 아래 순서대로 한 번만 설정하면 됩니다.

1. [supabase.com](https://supabase.com) 에서 무료 프로젝트를 생성합니다.
2. Supabase 대시보드 → **SQL Editor** 에서 [`supabase/schema.sql`](supabase/schema.sql) 파일 전체 내용을 붙여넣고 Run 합니다.
   - 테이블(매장/사용자/적립/쿠폰/설정), 보안 정책(RLS), 관리자 인증 함수가 모두 생성됩니다.
   - 기본 매장 3곳과 총괄 관리자 비밀번호(`1234`)가 자동으로 생성됩니다.
3. Supabase 대시보드 → **Project Settings → API** 에서 `Project URL` 과 `anon public` 키를 복사합니다.
4. 저장소의 [`supabase-config.js`](supabase-config.js) 파일을 열어 `url` / `anonKey` 값을 붙여넣은 값으로 교체합니다.
5. 멀티파일 버전을 수정했다면 `node build-standalone.js` 를 실행해 `app-standalone.html` 을 다시 생성합니다.
6. 배포 후 관리자 화면에 로그인해 **총괄 관리자 비밀번호를 즉시 변경**하세요(대시보드 탭 하단).

> `anon` 키는 브라우저에 그대로 노출되는 공개 키입니다(Supabase의 설계 방식). 실제 접근 제어는
> `supabase/schema.sql` 의 Row Level Security + 서버 함수(비밀번호 검증)가 담당하므로 안전하게 커밋할 수 있습니다.

---

## 파일 구성

| 파일 | 설명 |
|---|---|
| `index.html` | 사용자 화면 (등록 / 적립판 / 적립 내역 / 쿠폰함) |
| `app.js` | 사용자 화면 로직 (Supabase 비동기 호출) |
| `admin.html` | 관리자 화면 |
| `admin.js` | 관리자 화면 로직 (총괄/매장별 로그인, 매장·적립·쿠폰·설정·초기화) |
| `styles.css` | 공통 스타일 (모바일 우선 · 크림/코발트블루/살구색) |
| **`db.js`** | **데이터 레이어** — Supabase 클라이언트 호출 + 화면에 노출되는 `window.DB` API |
| `supabase-config.js` | Supabase 프로젝트 URL/anon 키 설정 (배포 전 필수 수정) |
| `supabase/schema.sql` | Supabase에 실행할 테이블·보안 정책·관리자 인증 함수 정의 |
| `qr.js` | 매장 URL을 QR 코드로 생성(화면 표시 / PNG 저장 / 인쇄). 관리자 화면에서 사용 |
| `scan.js` | 사용자 인앱 적립 입력 — 카메라 QR 스캔 + Web NFC 읽기, store 값 파싱 |
| `vendor/qrcode.min.js` | QR 생성 라이브러리 (qrcode-generator, MIT, 무의존 · 오프라인) |
| `vendor/jsqr.min.js` | QR 스캔(디코딩) 라이브러리 (jsQR, Apache-2.0, 무의존 · 오프라인) |
| `app-standalone.html` | 위 파일들을 하나로 합친 **단일 파일** (해시 라우팅, GitHub Pages 등에 그대로 올릴 수 있음) |
| `build-standalone.js` | 단일 파일 생성 스크립트 (`node build-standalone.js`) |

> 유지보수는 멀티파일(`index.html` 등)을 기준으로 하고, 배포는 단일 파일(`app-standalone.html`)이 편합니다.
> 항상 소스는 멀티파일이 원본이며, 멀티파일을 고친 뒤에는 반드시 `node build-standalone.js` 로 다시 생성하세요.

---

## 실행 방법

Supabase 설정(위 섹션)을 마쳤다면, 정적 파일만 서빙하면 됩니다.

```bash
# 프로젝트 폴더에서
python3 -m http.server 8080
#  → 사용자 화면 : http://localhost:8080/index.html
#  → 매장 접속   : http://localhost:8080/index.html?store=store_001
#  → 관리자 화면 : http://localhost:8080/admin.html
```

또는 `app-standalone.html` 파일 하나만 정적 호스팅(GitHub Pages/Netlify/Vercel 등)에 올려도 됩니다.

> ⚠️ `file://` 로 직접 열면 브라우저 보안정책으로 일부 기능(카메라 QR 스캔, NFC)이 제한되니
> 반드시 **http(s) 서버**로 여세요.

### GitHub Pages로 배포하기

1. 이 저장소를 GitHub에 push 합니다.
2. 저장소 **Settings → Pages** 에서 소스를 `main` 브랜치 `/ (root)` 로 지정합니다.
3. 몇 분 후 `https://<계정>.github.io/<저장소명>/app-standalone.html` 로 접속할 수 있습니다.
4. 매장 NFC 태그/QR에는 `.../app-standalone.html?store=store_001` 형태의 URL을 사용하세요.

---

## NFC 태그에 기록할 URL 예시

NFC 태그에는 **매장별 URL**을 저장합니다. 사용자가 태그하면 그 URL이 열리고 자동으로 해당 매장 적립 화면이 뜹니다.

```
https://<서비스주소>/app-standalone.html?store=store_001   (성수 카페)
https://<서비스주소>/app-standalone.html?store=store_002   (동네 베이커리)
https://<서비스주소>/app-standalone.html?store=store_003   (한바퀴 식당)
```

관리자 화면 → **매장 관리**(또는 매장 관리자의 **내 매장**)에서 각 매장의 URL을 바로 복사하거나 테스트할 수 있습니다.
(NFC 태그 기록은 "NFC Tools" 같은 무료 앱에서 URL 레코드로 저장)

### QR 코드 (NFC 없이도 적립)

NFC 태그가 없어도 **같은 URL을 QR 코드로 만들어** 매장에 붙여두면, 손님이 폰 카메라로 스캔해 동일하게 적립할 수 있습니다.

- 관리자 화면 → 매장 목록의 **`📷 QR 코드`** 버튼 → 화면에 QR 표시
- **PNG 저장** / **인쇄** 로 스티커·포스터로 출력해 매장에 부착
- QR은 매장별 URL(`?store=매장ID`)을 담고 있어 스캔하면 바로 그 매장 적립 화면이 열림
- QR 생성은 `vendor/qrcode.min.js`로 처리되어 **인터넷 없이(오프라인)도 동작**

### 도장 받는 3가지 방법 (사용자)

같은 매장 URL을 여는 통로만 다를 뿐, 도장 적립 동작은 동일합니다.

1. **NFC 태그** — 매장 NFC 태그를 폰에 태그 → 매장 URL이 열림 → “스탬프 적립하기”
2. **QR 스캔(폰 기본 카메라)** — 매장에 붙은 QR을 카메라로 스캔 → 매장 URL이 열림 → “스탬프 적립하기”
3. **앱 안에서 「📍 도장 받기」** — 홈 상단 버튼 → **QR 스캔** 또는 **NFC 태그** 선택
   - QR 스캔: 앱이 카메라를 열어 매장 QR을 인식(https·카메라 권한 필요)하면 즉시 적립
   - NFC 태그: Web NFC로 태그를 읽어 즉시 적립 (**안드로이드 크롬** 등 지원 기기 한정, https 필요)
   - 미지원 기기에서는 안내가 뜨며, QR 스캔 또는 위 1·2번 방법을 쓰면 됩니다

> 인앱 카메라/NFC는 보안상 **https**(또는 localhost)에서만 동작합니다.

---

## 관리자 기능

관리자 로그인은 두 가지 방식을 지원합니다.

- **총괄 관리자** — 모든 매장을 관리. 기본 비밀번호 `1234` (로그인 후 대시보드에서 즉시 변경 권장)
  - 대시보드(통계·운영 설정), 매장 관리(추가/수정/운영중지/QR/매장별 비밀번호 설정), 전체 적립 내역, 전체 쿠폰 사용 처리, 초기화
- **매장 관리자** — 각 매장 사장님이 총괄 관리자가 설정해준 **매장 전용 비밀번호**로 로그인
  - 내 매장 정보 수정/운영중지, 내 매장 비밀번호 변경, 우리 매장 적립 내역, 쿠폰 사용 처리(자기 매장 기준)만 가능

새 매장을 추가하려면: 총괄 관리자로 로그인 → 매장 관리 → **+ 매장 추가** → 매장 목록에서 **🔑 매장 비밀번호 설정** 으로
그 매장 사장님에게 알려줄 비밀번호를 만들어 전달하세요.

비밀번호 검증과 데이터 변경은 전부 Supabase 서버(Postgres 함수)에서 처리되어, 브라우저 콘솔로 값을 조작해도
서버 쪽 검증을 우회할 수 없습니다.

---

## 데이터 구조 (Supabase Postgres, `supabase/schema.sql`)

```
stores:       id, name, category, active, admin_password_hash, created_at
app_users:    id, name, phone_last4, created_at
stamp_wallet: user_id, current_stamp_count, goal_count, updated_at   // 사용자당 1개 (공동 적립판)
stamp_events: id, user_id, store_id, stamped_at, stamp_count_after, status
coupons:      id, user_id, title, benefit, issued_at, expires_at, status, used_at, used_store_id
app_config:   id(=1), goal_count, cooldown_seconds, coupon_validity_days, master_password_hash
```

모든 테이블은 Row Level Security로 **읽기(SELECT)만 공개**되어 있고, 매장 추가/수정/활성화, 비밀번호 변경,
쿠폰 사용 처리, 설정 변경, 초기화 등 모든 **쓰기 작업은 서버 함수(RPC)** 를 통해서만 가능합니다.
각 함수는 호출 시마다 비밀번호를 서버에서 재검증합니다.

---

## 예외 처리

- 사용자 등록 전에는 적립 불가
- 미등록 / 운영 중지 매장에서는 적립 불가
- 같은 매장 중복 적립 방지(설정 가능한 쿨다운) + 버튼 연속 클릭 방지
- 같은 쿠폰 재사용 불가, 사용 완료 상태는 되돌리지 않음
- 유효기간 지난 쿠폰은 사용 처리 불가(자동 만료 표시)
- 적립·쿠폰 발급은 서버 함수 내부에서 원자적으로 처리되어 여러 기기의 동시 적립에도 안전
- `?store=` 에 임의 문자열이 들어와도 오류 없이 "등록되지 않은 매장" 안내
- Supabase 연결 실패 시 사용자/관리자 화면 모두 안내 메시지를 표시(빈 화면 방지)

---

## 알려진 한계 (다음 단계로 개선 가능)

- 손님 식별은 기기별 로컬 저장(전화번호 실제 인증 없음) — 같은 손님이 다른 기기에서 접속하면 다른 사용자로 인식됨
- 관리자 세션은 비밀번호를 `sessionStorage`에 보관해 매 요청마다 서버 재검증에 사용(탭을 닫으면 소멸) — 정식 로그인/토큰 기반 인증(Supabase Auth)으로 교체하면 더 견고해짐
- 결제·정산·위치 인증·푸시 알림 없음
- 관리자 계정에 세분화된 권한(읽기 전용 등)이나 감사 로그는 없음

---

## 디자인

- 모바일 우선(360px 대응), 따뜻한 크림 배경 + 진한 코발트블루 주색 + 살구색 보조색
- 종이 스탬프 카드 + 디지털 지갑 감성, 적립/발급/사용 상태를 색으로 명확히 구분

