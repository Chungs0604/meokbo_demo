# TASKS — claude-cs

> [PRD.md](./PRD.md) 의 로드맵을 단계별 체크리스트로 분해한 문서.
> 작업이 끝날 때마다 체크박스를 갱신한다.

**진행 상황**: Phase 1~3 완료 · Phase 5 진행 중 (모드 전환 UI 는 Phase 5 로 이관)

| Phase | 상태 |
| --- | --- |
| Phase 1 — Electron 환경 + 창 추적 | ✅ **완료** (멀티 모니터만 미검증) |
| Phase 2 — 사용량 데이터 | ✅ **완료** (모드 전환 UI 는 Phase 5 로 이관) |
| Phase 3 — 캐릭터 상태 머신 | ✅ 완료 (PEEK 전이는 Phase 4) |
| Phase 4 — 빼꼼 완료 알림 | ⬜ 대기 |
| Phase 5 — 에셋·연출 | 🔶 진행 중 (에셋 파이프라인·모션 4종·트림 연출 완료, 트레이·패키징 남음) |

---

## Phase 0 — 문서

- [x] `PRD.md` 작성
- [x] `TASKS.md` 작성

---

## Phase 1 — Electron 환경 구축 및 터미널 창 위치 추적

### 1.1 프로젝트 셋업

- [x] `package.json` 생성 (`main`, `scripts.start` / `dev` / `diag`)
- [x] `electron` 설치 (devDependency, v44.5.1)
- [x] 창 추적 방식 확정 — `get-windows` 로 시작했으나 **호출당 36.8ms(프로세스 매번 생성)** 라
      드래그 추종이 버벅여서, 상주 Swift 헬퍼(`CGWindowList`, 0.376ms)로 교체했다
- [x] `get-windows` 제거 — 런타임 의존성 0개, npm audit 6건(critical 1) → 0건
- [x] `scripts/build-native.mjs` — swiftc 빌드, 소스가 더 새로울 때만 재컴파일.
      `prestart`/`predev`/`prediag` 로 자동 실행
- [x] `.gitignore` 작성
- [x] 디렉터리 구조 생성 (`src/main`, `src/preload`, `src/renderer/overlay`, `scripts`)

### 1.2 오버레이 윈도우

- [x] `BrowserWindow` 생성: `transparent`, `frame: false`, `hasShadow: false`
- [x] `alwaysOnTop` 을 `screen-saver` 레벨로 설정 + macOS `type: 'panel'`
- [x] `focusable: false` — 입력 포커스를 절대 가져가지 않게 (NFR-03)
- [x] `setIgnoreMouseEvents(true, { forward: true })` — 클릭 통과 (NFR-02)
- [x] `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`
- [x] macOS Dock 아이콘 숨김 (`app.dock.hide()`)
- [x] 단일 인스턴스 락 (`requestSingleInstanceLock`)
- [x] 종료 수단 — Dock·트레이가 없어 전역 단축키 `Control+Alt+Shift+Q` 를 임시로 둠 (트레이는 Phase 5)

### 1.3 Active Window 추적

- [x] `native/macos/window-watcher.swift` — 상주 헬퍼. 변화가 있을 때만 NDJSON 한 줄 출력
- [x] 적응형 폴링 — 마지막 변화 후 2초간 60Hz, 이후 5Hz
- [x] **활성 앱은 "맨 위 창"이 아니라 `NSWorkspace` 활성화 알림으로 판정** —
      CGWindowList 앞뒤 순서는 앱 전환 순간 수십 ms 간 뒤집혔다 돌아와, 60Hz 로 읽으면 캐릭터가 깜빡였다
- [x] 화면 밖 보조 창 제외 — Chrome 등이 화면 밖에 두는 layer 0 창을 집어 캐릭터가 엉뚱한 데로 가던 문제
- [x] `NSScreen` 조회 결과 캐시(TTL 2초) — 매 샘플 조회 시 헬퍼 CPU 가 2.0% 까지 올랐다
- [x] **유휴 CPU 실측: 전체 합계 0.4%** (헬퍼 0.4, Electron 전 프로세스 0.0) — NFR-01 충족
- [x] 부모 프로세스 사망 시 헬퍼 자동 종료 (`getppid() == 1`)
- [x] 헬퍼 비정상 종료 시 재시작(최대 5회) 후 명확한 에러로 포기 (NFR-04)
- [x] 창 소스 어댑터 분리 — `sources/` 에 macOS/폴백을 같은 이벤트 계약으로 (FR 확장 대비)
- [x] 터미널 앱 화이트리스트 판정 (macOS bundleId 정본, 그 외 OS 는 앱 이름 폴백)
- [x] bounds 변화 감지 — 변화 없으면 이벤트·창 이동 생략
- [x] `target` / `target-lost` / `error` 이벤트 방출
- [x] macOS 권한 **불필요** — 창 제목을 읽지 않고 bounds·pid 만 읽는다
- [x] 비터미널 앱 활성화 시 `not-terminal` 로 숨김 전환 (FR-05)

### 1.4 위치 동기화

- [x] 대상 창 bounds → 캐릭터 오버레이 좌표 (창 상단 테두리에 올라앉는 형태, FR-02)
- [x] 대상 창 이동·리사이즈 추종 (FR-03)
- [x] Windows 물리픽셀 → DIP 변환 경로 분기 (`screen.screenToDipRect`)
- [ ] 멀티 디스플레이 좌표 보정 — `getDisplayNearestPoint` 로 구현했으나
      **모니터가 1대뿐이라 실측 미검증** (FR-06)
- [x] 대상 상실 시 오버레이 숨김, `lastTarget` 보존 (FR-04)

### 1.5 렌더러 (플레이스홀더)

- [x] `index.html` + `overlay.css` — 배경 완전 투명 (캡처 알파 실측: 모서리 α=0)
- [x] CSS 도형 캐릭터 플레이스홀더 — `--fatness`(0~1) 로 체형·모션 속도 전환 가능
- [x] `preload/overlay.cjs` — `contextBridge` 로 상태 **수신** 채널만 노출 (sandbox 유지)
- [x] 디버그 오버레이 — 추적 중인 앱 이름·창 bounds·오버레이 bounds 표시 (`npm run dev`)

### 1.6 Phase 1 검증 결과

수동 검증 체크리스트: [VERIFY-PHASE1.md](./VERIFY-PHASE1.md)

검증 도구: `npm run diag` (로직·좌표), `npm run diag:capture` (렌더 캡처), `npm run dev` (실행 로그)

- [x] 좌표 계산 경계 케이스 5종 통과 — 일반 창 / 화면 상단 / 좌·우 끝 / 화면보다 넓은 창
- [x] 터미널 판정 단위 체크 7종 통과 (iTerm·Terminal·ghostty / Finder·Spotify / WindowsTerminal·explorer)
- [x] 오버레이 렌더 + 투명도 실측 — 캐릭터 α=255, 배경 모서리 α=0
- [x] 실행 e2e — iTerm 활성화 → `target`, Finder 활성화 → `target-lost: not-terminal`, 다시 iTerm → `target`
- [x] 창 이동 추종 — 로그상 bounds `x:178→185→186, y:70→113→146→155` 변화를 따라감
- [x] **육안 확인 완료** — 캐릭터가 터미널 테두리에 올라앉은 모습, 투명 배경, 숨쉬기 모션
- [x] **클릭 통과 완료** — 몸통 클릭 시 뒤 창으로 전달, 발 부분 드래그로 창 이동, 스크롤 통과
- [x] **포커스 비탈취 완료** — 타이핑 끊김 없음, `Cmd+Tab` 목록에 미노출
- [x] **전체화면 / Space 전환 완료** — 전체화면은 Phase 3 시점에 재확인했다.
      다만 Space **전환 애니메이션 중** 잔상이 보이는 것이 Phase 3 에서 드러났다 (아래 3.3 참고)
- [ ] **멀티 모니터 미검증** — 검증 시점에 디스플레이 1대뿐이라 실행 불가 (FR-06)

## Phase 2 — Claude Code 사용량 데이터 파싱 및 한도 옵션

### 2.1 데이터 소스 조사 (PRD Q1·Q2) — **조사 완료, 결과는 PRD §7**

- [x] `~/.claude` 하위 구조 조사 — policy-limits·telemetry·sessions·cache 전부 확인
- [x] 트랜스크립트 `usage` 필드 스키마 확정 (input/output/cache/thinking 토큰 상세 존재)
- [x] 트랜스크립트에 `rate_limits` 가 있는지 확인 → **없음** (전체 트랜스크립트 검사)
- [x] 공식 수치 소스 발견 — `statusLine` payload 의 `rate_limits.five_hour / seven_day`
      (`used_percentage` 0~100 + `resets_at` epoch seconds)
- [x] 5시간·주간 윈도우 경계 → `resets_at` 이 직접 제공되므로 자체 계산 불필요
- [x] 플랜별 한도 절대값 → **불필요해짐** (percentage 를 직접 받음)
- [x] PRD.md 에 조사 결과 §7 로 반영
- [x] **채택안 결정 → D (statusLine 단독 + 훅 병행)**. 근거는 PRD §7.5
- [x] Meokbo 상태 확인 — 이미 미동작(프로세스 없음, 훅·statusline 무출력). 보존 대상 아님

### 2.2 Claude Code 연동 설치

- [x] 전역 `settings.json` 백업 후 Meokbo 훅 8개 + statusLine 제거
      (`PreToolUse`/`PostToolUse` 가 툴 호출마다 약 9ms 를 낭비하고 있었다)
- [x] 훅 클라이언트를 **Swift 로 작성** — Node 는 기동만 43ms 인데 statusLine 은 렌더링마다
      호출된다. 네이티브는 3.1ms
- [x] `statusLine` 커맨드 — payload 에서 직접 `5h N% · 7d N%` 를 만들어 출력하고,
      같은 payload 를 소켓으로 전달 (앱이 꺼져 있어도 상태줄은 정상 동작)
- [x] `Stop` / `StopFailure(rate_limit)` / `UserPromptSubmit` / `SessionStart` / `SessionEnd` 훅 등록
- [x] 훅은 소켓에 쓰고 즉시 종료 — 송신 타임아웃 200ms, 응답 대기 없음
- [x] 소켓 부재(앱 미실행) 시 조용히 `exit 0` — 훅 실패는 Claude Code 에 에러로 뜬다
- [x] 설치/제거 멱등 — `npm run hooks:install` / `hooks:uninstall` / `hooks:status`,
      실행 전 자동 백업, 우리 항목만 선별 제거 (사용자 훅은 건드리지 않음)
- [x] **기본값을 프로젝트 전용으로** (`.claude/settings.json`). 전역은 `--global` 로 명시적 opt-in

### 2.3 UsageMonitor 구현

- [x] 로컬 소켓 서버 — statusLine·훅 payload 수신
- [x] `rate_limits.five_hour` / `seven_day` 파싱 → `used_percentage`, `resets_at`
- [x] `rate_limits` 부재 처리 — 비구독자이거나 첫 API 응답 전이면 없다. 정상 경로로 다룬다
- [x] 더 빠른 리셋 선택 로직 — 두 `resets_at` 중 min (FR-22 타이머용)
- [x] 리셋 감지 → `resets_at` 전진 또는 `used_percentage` 급락 시 `reset` 이벤트 (FR-13)
- [x] 토큰 소모 **속도**(tokens/min) 산출 — 컨텍스트 압축으로 총량이 줄면 속도로 치지 않는다 (FR-20)
- [x] 3분 무활동 Idle 판정 (FR-21)
- [x] 작업 완료 / 한도 소진 이벤트 방출 (FR-30, FR-22)
- [x] 파일을 읽지 않는다 — 훅이 밀어주는 데이터만 쓴다 (NFR-05 자동 충족)
- [x] **단위 테스트 16건 전부 통과** (`npm run test:usage`)

### 2.4 한도 모드 설정

- [x] 설정 저장소 (`userData/config.json`) — 읽기·기본값
- [x] `limitMode: '5h' | 'weekly'` (기본값 `'5h'`, FR-10)
- [x] `setLimitMode()` — 모드 변경 시 즉시 사용률 재계산·재방출 (단위 테스트 커버)
- [ ] 설정 쓰기(저장) 경로 — **Phase 5 로 이관**. 저장할 창구인 트레이 메뉴가 Phase 5 라
      쓰기만 먼저 만들면 호출자가 없다
- [ ] 트레이 메뉴 또는 설정 창에서 모드 전환 UI — **Phase 5 로 이관** (트레이 아이콘과 함께)

### 2.5 Phase 2 검증

- [x] 모의 훅으로 파이프라인 end-to-end 확인 — statusline/Stop/StopFailure/UserPromptSubmit 전부 수신
- [x] `UsageMonitor` 단위 테스트 16건 통과
- [x] **실제 Claude Code 세션에서 `rate_limits` 수신 확인** (2026-10-06, 세션 재시작 후)
      — `five_hour` 10% / `seven_day` 13%, `resets_at` → 10-06 03:20 · 10-11 06:00 로 환산 정상.
      `context_window` 도 함께 와서 `tokensPerMinute` 산출까지 동작
- [x] 훅 3종 실발화 확인 — `statusline` 17회, `UserPromptSubmit` 1회,
      `Stop` 1회(→ `complete` 이벤트에 실제 `session_id` 실림)
- [x] 프로젝트 전용 설정만으로 훅·statusLine 동작 확인 (전역에는 우리 항목이 없는 상태)
- [ ] 프로젝트 설정이 전역을 **덮는지** 는 미검증 — 양쪽에 동시 등록한 충돌 상황을
      만들지 않았다. `--global` 옵션을 쓸 때 확인한다
- [ ] 한도 모드 전환 시 사용률 수치가 바뀌는지 **실측** — 전환 UI 가 Phase 5 라 함께 확인
- [x] 리셋 감지 실측 — `five_hour` 리셋(10-06 03:20) 통과 후 `reset` 이벤트 발생.
      `usedPercentage` 30 → 0, `resetsAt` 03:20 → 14:10 으로 전진.
      **다만 이벤트는 03:20 이 아니라 리셋 이후 첫 statusLine 호출 시점(09:1x)에 떴다** —
      statusLine 은 Claude Code 가 렌더할 때만 불리므로, 리셋 시각에 바로 알 방법이 없다.
      FR-22 카운트다운은 `nextResetAt` 을 렌더러에서 직접 세야 한다 (Phase 3)

**관찰**: `tokensPerMinute` 가 샘플 간 746 → 91920 → 16158 로 크게 튄다. statusLine 호출
간격이 불규칙한 탓이다. FR-20 밥 먹는 속도 연출에 원값을 그대로 쓰면 모션이 떨리므로
Phase 3 에서 평활화가 필요하다.

---

## Phase 3 — 캐릭터 상태 머신

> **작업 단위**: PR 두 개로 나눈다.
> **PR A** = 데이터 배선 + 체형 매핑 + 디버그 주입 수단 (브랜치 `feat/phase3-fatness`).
> **PR B** = `StateMachine` + 모션 + `tokensPerMinute` 평활화.
> PR A 끝에서 "사용률에 따라 캐릭터가 뚱뚱해지는 것"을 눈으로 확인할 수 있어야 한다.

### 착수 전에 정한 것

- **체형 계산은 main, 보간은 렌더러.** main 이 `fatness`(0~1) 와 단계를 계산해 usage
  스냅샷에 실어 보내고, 렌더러는 `--fatness` CSS 변수에 넣어 transition 으로 잇는다.
  렌더러는 sandbox + CSP `'self'` 라 ESM import 가 없어 모듈을 공유할 수 없다.
  계산을 main 에 두면 Electron 없이 단위 테스트할 수 있고, PRD §4 도표의
  "렌더러 = 체형 보간" 과도 맞는다. `StateMachine` 도 도표대로 main 에 둔다
- **`WORKING` 은 `isIdle` 의 여집합으로 다룬다.** PRD 는 `WORKING` 을 "Claude Code 가
  작업 중" 이라고만 적어 `Stop` 훅 직후부터 3분 사이가 비어 있다. FR-21 이
  "3분 무활동 → `IDLE`" 이므로 그 여집합을 `WORKING` 으로 본다. 토큰 소모가 없으면
  `tokensPerMinute` 가 0 이라 밥 먹는 모션이 자연히 멈추므로 어색하지 않다
- **디버그 사용률 주입은 기존 소켓 경로를 그대로 쓴다.** 프로덕션 코드에 백도어를
  넣지 않는다. 100% 기절·리셋 타이머는 주입 없이 검증할 방법이 없다
  ```bash
  echo '{"rate_limits":{"five_hour":{"used_percentage":100,"resets_at":1791224400}}}' \
    | ./native/macos/bin/hook-client statusline
  ```
  활성 Claude Code 세션이 있으면 진짜 statusLine 이 주입값을 곧 덮어쓴다.
  테스트 중에는 Claude Code 를 쓰지 않거나 주입을 반복한다
- **`overlay:usage` 배선이 선행 조건이다.** 현재 main 은 보내지만 preload 에 수신
  채널이 없다

### 3.1 체형 시스템

- [x] 사용률 → 체형 단계 매핑 (0~33 / 34~66 / 67~99 / 100) — `src/main/fatness.js`.
      PRD 표는 정수지만 실제 `used_percentage` 는 소수로 와서(실측 28.999999999999996)
      "미만" 경계로 구현했다 (`<34` / `<67` / `<100`)
- [x] 단계 간 보간 — main 이 `fatness`(0~1) 를 스냅샷에 싣고, 렌더러가 `--fatness` 에
      꽂아 `width`/`height` transition 600ms 로 잇는다 (FR-12).
      `--fatness` 는 미등록 커스텀 프로퍼티라 그 자체는 보간되지 않지만,
      그걸로 계산된 길이값은 보간된다
- [x] `overlay:usage` 를 렌더러까지 배선 — preload 에 `onUsage` 추가 (PR A 선행 조건이었음)
- [x] 단계별 모션 속도 계수 (쌩쌩 / 약간 느림 / 버거움) — CSS `--slow` 하나로
      모든 모션 길이에 곱한다 (slim 1 / chubby 1.3 / fat 1.7 / limit 2).
      연속값이 아니라 단계로 끊은 이유는 속도 변화가 눈에 띄어야 의미가 있어서다
- [x] 뚱뚱 단계(67~99%) 헥헥거림 연출 — 몸통 `scaleY` 진동.
      입이 아니라 몸으로 표현한 이유는 밥 먹는 모션(입)과 겹치지 않게 하려는 것이다

### 3.2 상태 머신

- [x] 상태 정의: `WORKING` / `IDLE` / `EXHAUSTED` / `PEEK` / `HIDDEN` — `src/main/state-machine.js`.
      **`PEEK` 는 상수만 두고 전이는 구현하지 않았다** (Phase 4 범위).
      전이표에서 이 상태가 끼어들 자리(EXHAUSTED 와 IDLE 사이)를 명시해 두려는 것이다
- [x] 전이 규칙·전이 조건 테이블 구현 — **우선순위가 있는 규칙**으로 짰다.
      대상 없음 → 소진 → (PEEK) → 무활동 → 그 외.
      `StateMachine` 은 타이머를 직접 돌리지 않는 리듀서라 Electron 없이 테스트된다
- [x] `WORKING` — 토큰 소모 속도에 비례한 밥 먹는 모션 (FR-20).
      `intake`(0~1)를 main 이 계산하고 CSS 가 입 애니메이션 주기로 환산한다
- [x] `tokensPerMinute` 평활화 — 이동평균이 아니라 **1분 슬라이딩 창 누적**으로 바꿨다.
      원값이 튄 원인이 "간격이 짧을수록 분모가 작아져 증폭" 이라, 분모를 고정하는 쪽이
      직접적인 해결이다. 결과값의 의미도 "최근 1분간 쓴 토큰 수" 로 직관적이다
- [x] 3분 무활동 감지 → `IDLE` (FR-21) — 판정은 기존 `UsageMonitor` 가 하고
      `StateMachine` 은 그 결과인 `isIdle` 만 본다
- [x] `IDLE` 뒹굴기 모션 + 살찐 상태 헥헥거림 추가
- [x] 100% → `EXHAUSTED` 기절 모션 (FR-22) — 눕기 + 눈 감기 + **애니메이션 정지**.
      `StopFailure` 훅으로 들어온 기절은 사용률로 풀 수 없다 (훅이 올 때 아직 100% 가
      아닐 수 있다). 한도가 실제로 풀려야(`reset` 이벤트) 깨어난다
- [x] `EXHAUSTED` 리셋 카운트다운 표시 (빠른 리셋 기준) — **렌더러가 직접 센다.**
      statusLine 은 Claude Code 가 화면을 그릴 때만 호출되므로 기절해 있는 동안에는
      새 수치가 영영 오지 않는다 (Phase 2 실측: 03:20 리셋을 09:1x 에야 알았다)

### 3.3 Phase 3 검증

- [x] 사용률을 강제 주입하는 디버그 명령으로 4단계 전부 재현 — `npm run inject -- <0~100>`.
      실제 소켓 경로(hook-client → IpcServer → UsageMonitor → `overlay:usage`)로
      0 / 40 / 80 / 100 을 넣어 `stage` 가 slim / chubby / fat / limit 로 바뀌는 것을 로그로 확인.
      주입 `resets_at` 은 **분 경계로 맞춘다** — 매 호출 초가 밀리면 FR-13 리셋 판정이 오탐한다
- [x] 체형 4단계 렌더 캡처 — `npm run diag:fatness` 가 단계별 PNG 를 남긴다.
      몸통 폭이 단조 증가하는 것을 육안 확인
- [x] 단위 테스트 36건 통과 (`npm run test:usage`, 기존 16 + 체형 20)
- [x] 100% 주입 → 기절 + 타이머 확인 — `npm run inject -- 100` 으로
      `[character] WORKING → EXHAUSTED (limit-reached)`, 40% 로 내리면 복귀 확인.
      `npm run diag:states` 캡처에 누운 자세·감은 눈·카운트다운 `1:23:00` 이 찍혔다
- [x] 캐릭터 상태별 렌더 캡처 — `npm run diag:states`
- [ ] **알려진 제약**: macOS Space 전환 애니메이션 중 캐릭터가 잠깐 스쳐 보인다.
      `screen-saver` 창 레벨이 전환 애니메이션 위에 고정되는 것이 원인으로 보인다.
      Space 소속 한정 / 레벨 낮추기 / `activeSpaceDidChange` 즉시 숨김 **셋 다 실패**했다
      (상세와 재시도 금지 사유는 `CLAUDE.md` 함정 항목).
      기능 영향 없음. 스프라이트가 들어오는 Phase 5 에서 다시 본다
- [x] 단위 테스트 60건 통과 (`npm run test:usage`, PR A 36 + 상태·속도 24)
- [x] 3분 대기 → Idle 전환 확인 — 마지막 토큰 소모 후 **약 3분 뒤 10:03:42 에**
      `[character] WORKING → IDLE (no-activity)`, 다시 작업하자 `IDLE → WORKING` 복귀.
      검증하려면 **앱을 띄워둔 채 Claude Code 를 3분간 쓰지 않아야 한다** —
      개발 중에는 토큰 소모가 계속 `lastActivityAt` 을 갱신해서 들어가지 않는다
- [x] `tokensPerMinute` 평활화 실데이터 확인 — 평상시 691 tpm / `intake` 0.035.
      Phase 2 의 폭주(최대 226971)가 재현되지 않는다

---

## Phase 4 — 빼꼼 완료 알림

### 4.1 완료 이벤트 수신

- [ ] 감지 방식 확정 (PRD Q3: `Stop` 훅 IPC vs 트랜스크립트 tail)
- [ ] 수신 채널 구현 (로컬 IPC 서버 또는 파일 워처)
- [ ] 세션 ↔ 터미널 창 매핑 — 어느 터미널에서 끝난 작업인지 식별

### 4.2 PeekWindow

- [ ] 화면 우측 사이드 전용 `BrowserWindow` 생성
- [ ] 슬라이드 인 / 아웃 애니메이션 (FR-30)
- [ ] 클릭 가능 영역 — 오버레이와 달리 마우스 이벤트 수신 (FR-31)
- [ ] 클릭 시 원래 터미널 창 포커스 이동 (FR-31)
- [ ] 자동 소멸 타이머 기본 20초 (FR-32)
- [ ] 터미널 재활성화 시 즉시 소멸 (FR-33)
- [ ] 터미널이 활성 상태면 빼꼼 생략 (FR-34)

### 4.3 Phase 4 검증

- [ ] 다른 앱을 보는 동안 작업 완료 → 우측에서 빼꼼 등장
- [ ] 빼꼼 클릭 → 해당 터미널 창이 전면으로 복귀
- [ ] 터미널을 보는 동안 완료 → 빼꼼 등장 안 함

---

## Phase 5 — UI / 에셋 연동 및 리셋 트림 연출

### 에셋 제작 방식 (PRD Q4 해소)

- **생성 AI 로 뽑고 빌드가 정리한다.** 캐릭터 1종을 확정한 뒤, 모션별로
  "한 장에 격자로 배치된 프레임"을 받는다. 프레임을 한 장씩 받는 방식은 너무 느렸다
- **`npm run build:sheet` 이 격자를 잘라 시트로 굽는다** (`scripts/build-sheet.mjs`).
  생성물을 그대로 쓸 수 없는 이유가 세 가지였다:
  1. 투명 배경 대신 **체크무늬를 그림으로 그려서** 준다 → 테두리에서 flood fill 로 제거.
     색만 보고 지우면 배경과 똑같이 순백인 **눈 흰자가 같이 날아간다**
  2. 캔버스 크기와 캐릭터 위치가 제각각이다 → 발끝 기준으로 재정렬
  3. 격자 칸 크기가 균일하지 않다 → 빈 공간을 찾아 **우리가 자른다**.
     모델에게 셀 크기를 맡기지 않는 것이 요점이다
- 원본(`assets/raw/`)은 59MB 라 **git 에 넣지 않는다.** 구운 시트만 커밋한다
- 시트 규약: **행 = 체형 단계, 열 = 프레임**. 행 순서는 `config.js` 의 `FATNESS_STAGES` 와 같다

### 진행

- [x] 체형 단계별 캐릭터 스프라이트 시트 반영 (PRD Q4)
- [x] 플레이스홀더 → 실제 에셋 교체 및 CSS 정리
- [x] 모션: **밥 먹기**(`eat`, 체형 4 x 8프레임)
- [x] 모션: **뒹굴기**(`roll`, 체형 4 x 6프레임) — 누워서 뒹구는 자세
- [x] 모션: **기절**(`faint`, 4프레임) — 누운 자세 + 머리 주위를 도는 파리
- [x] 헥헥거림 — 전용 프레임 없이 CSS 로 몸통을 미세하게 눌렀다 편다.
      `fat`/`limit` 의 지친 표정은 이미 그림에 들어 있다
- [x] 모션: **트림**(`burp`, 체형 4 x 6프레임) — 서서 한 번 재생
- [x] 리셋 감지 시 **트림 연출** → 0%(홀쭉) 복귀 (FR-13).
      `StateMachine` 에 `BURP` 상태를 넣고 타이머는 `index.js` 가 든다 (리듀서를 타이머 없이 유지).
      **트림 중에는 체형 스냅샷을 붙잡아 둔다** — 안 그러면 리셋 샘플이 `reset` 바로 다음 줄에서
      0% 를 내보내서 트림과 홀쭉해지는 것이 겹쳐 한 동작으로 뭉개진다.
      실측 전이: `WORKING → EXHAUSTED(limit-reached) → BURP(limit-reset) → WORKING`,
      그 뒤 `트림 끝. 붙잡아 둔 체형을 내보낸다: slim`
- [ ] 리셋 타이머 UI 디자인 마감
- [ ] 트레이 아이콘 + 메뉴 (한도 모드 전환, 종료)
- [ ] 패키징 (`electron-builder`) 및 macOS 권한 안내 문구

### 작업하며 드러난 것

- **셀 높이와 폭은 제약이 다르다.** 높이는 창 배치가 묶는다 — 메뉴바 바로 아래 있는
  터미널은 캐릭터가 앉을 공간이 없어 클램프되고, 셀이 94px 를 넘으면 캐릭터가 창 안으로
  20px 넘게 파고든다(`npm run diag` 로 실측). 폭은 그런 제약이 없어서,
  누운 자세를 위해 폭만 104px 로 넓혔다.
  **뒤에 124px 로 한 번 더 넓혔다** — 누운 포즈는 높이를 `CHAR_HEIGHT` 에 맞추면 213px 까지
  벌어져서 결국 폭 상한이 크기를 정한다. 104px 에서는 서 있는 모션 대비 불투명 면적이
  뒹굴기 65% / 기절 76% 로 눈에 띄게 작았고, 124px 에서 95~110% 가 됐다
  (`npm run diag` 좌표 검증 5종 통과)
- **체형 보간(FR-12)은 레이어 2장 크로스페이드다.** 그림이 4단계뿐이라 폭을 연속으로
  늘리던 플레이스홀더 방식을 쓸 수 없다. 새 레이어를 페이드 인 시킬 때
  **이전 레이어도 같이 지워야 한다** — 안 지우면 실루엣이 달라 옛 몸이 비쳐 두 겹으로 보인다
  (늘어날 때는 새 몸이 덮어 가려지고 **줄어들 때 드러나서**, `diag:fatness` 에
  줄어드는 구간을 추가해 잡았다)
- 생성 AI 는 "프레임을 충분히 띄워라"라고 해도 **캔버스의 0.9% 까지** 붙여 준다.
  칸 분리 기준을 2% 로 잡았다가 한 행이 통째로 한 칸으로 잡혔다. 0.4% 로 내렸다
- **그 1차원 기준이 트림에서 완전히 무너졌다.** 입에서 나온 구름이 옆 칸 캐릭터와
  **닿지도 않았는데** x 범위가 겹쳐서 2x3 격자가 chubby 4칸 / fat·slim 5칸으로 잡혔다.
  행·열 히스토그램을 버리고 **2차원 연결 덩어리**로 바꿨다. 덤으로 칸 사각형이 겹칠 때
  옆 칸 조각이 묻어 오던 것도 같이 잡았다(자를 때 다른 덩어리 픽셀을 지운다).
  큰 덩어리 판정 기준은 중앙값 → **최댓값** — 기절 격자는 파리 때문에 덩어리가 155개라
  중앙값이 잡티 쪽으로 쏠려 4칸이 16칸이 됐다.
  기존 모션(`eat`/`roll`/`faint`) 프레임 수는 그대로고 그림도 육안상 동일하다
- **한 모션의 프레임 수는 체형 4단계가 같아야 한다.** CSS 가 모션당 `--columns` 와
  `steps()` 를 하나씩만 쓴다. 트림 `limit` 만 3x3(9칸)으로 와서 쓸 6칸을 골라
  `limit-1.png` ~ `limit-6.png` 낱장으로 저장했다 (원본 9칸 격자는 백업의 `_original/`)
- **한 번만 재생하는 모션은 키프레임 이름이 달라야 한다** (`frames-once`).
  `frames` 를 그대로 쓰면 돌고 있던 애니메이션이 시작 시각을 유지한 채 이어져서,
  경과 시간이 1.8초를 넘은 상태(밥 먹는 중)에서 넘어오면 트림이 통째로 사라진다.
  `diag:states` 캡처가 첫 칸에 멈춰 있어서 발견했다
- `nativeImage.resize()` 는 **알파를 날린다**(결과의 91%가 불투명해졌다).
  알파 가중 평균 박스 필터를 직접 구현했다

---

## 백로그 (Phase 범위 외)

- [ ] Windows / Linux 창 추적 어댑터 완성 (PRD Q5) — `sources/polling-window-source.js` 에 자리는 있으나
      `get-windows` 미설치 상태라 실제로 돌려본 적이 없다
- [ ] 네이티브 헬퍼 코드서명 — 배포 시 Gatekeeper 대응 (Phase 5 패키징)
- [ ] 좌표 미세 조정 — 창이 화면 최상단(y≈0)이면 위 공간이 없어 캐릭터가 테두리 안쪽으로 내려앉는다
- [ ] 터미널 앱 화이트리스트 사용자 편집 UI
- [ ] 사용량 히스토리 그래프
- [ ] 캐릭터 커스터마이즈 / 스킨
