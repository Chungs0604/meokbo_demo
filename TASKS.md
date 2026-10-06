# TASKS — claude-cs

> [PRD.md](./PRD.md) 의 로드맵을 단계별 체크리스트로 분해한 문서.
> 작업이 끝날 때마다 체크박스를 갱신한다.

**진행 상황**: Phase 1 완료 · Phase 2 완료 (모드 전환 UI 는 Phase 5 로 이관)

| Phase | 상태 |
| --- | --- |
| Phase 1 — Electron 환경 + 창 추적 | ✅ **완료** (멀티 모니터만 미검증) |
| Phase 2 — 사용량 데이터 | ✅ **완료** (모드 전환 UI 는 Phase 5 로 이관) |
| Phase 3 — 캐릭터 상태 머신 | ⬜ 대기 |
| Phase 4 — 빼꼼 완료 알림 | ⬜ 대기 |
| Phase 5 — 에셋·연출 | ⬜ 대기 |

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
- [x] **전체화면 / Space 전환 완료**
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

### 3.1 체형 시스템

- [ ] 사용률 → 체형 단계 매핑 (0~33 / 34~66 / 67~99 / 100)
- [ ] 단계 간 보간 — 체형을 연속값으로 다루고 CSS 변수로 전달 (FR-12)
- [ ] 단계별 모션 속도 계수 (쌩쌩 / 약간 느림 / 버거움)
- [ ] 뚱뚱 단계(67~99%) 헥헥거림 연출

### 3.2 상태 머신

- [ ] 상태 정의: `WORKING` / `IDLE` / `EXHAUSTED` / `PEEK` / `HIDDEN`
- [ ] 전이 규칙·전이 조건 테이블 구현
- [ ] `WORKING` — 토큰 소모 속도에 비례한 밥 먹는 모션 (FR-20)
- [ ] `tokensPerMinute` 평활화 — statusLine 호출 간격이 불규칙해 원값이 100배까지
      튄다 (Phase 2 실측). 이동평균 등으로 눌러야 모션이 안 떨린다
- [ ] 3분 무활동 감지 → `IDLE` (FR-21)
- [ ] `IDLE` 뒹굴기 모션 + 살찐 상태 헥헥거림 추가
- [ ] 100% → `EXHAUSTED` 기절 모션 (FR-22)
- [ ] `EXHAUSTED` 리셋 카운트다운 표시 (빠른 리셋 기준)

### 3.3 Phase 3 검증

- [ ] 사용률을 강제 주입하는 디버그 명령으로 4단계 전부 재현
- [ ] 3분 대기 → Idle 전환 확인
- [ ] 100% 주입 → 기절 + 타이머 확인

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

- [ ] 체형 단계별 캐릭터 스프라이트 시트 반영 (PRD Q4)
- [ ] 모션 세트: 밥 먹기 / 뒹굴기 / 헥헥 / 기절 / 트림
- [ ] 플레이스홀더 → 실제 에셋 교체 및 CSS 정리
- [ ] 리셋 감지 시 **트림 연출** → 0%(홀쭉) 복귀 (FR-13)
- [ ] 리셋 타이머 UI 디자인 마감
- [ ] 트레이 아이콘 + 메뉴 (한도 모드 전환, 종료)
- [ ] 패키징 (`electron-builder`) 및 macOS 권한 안내 문구

---

## 백로그 (Phase 범위 외)

- [ ] Windows / Linux 창 추적 어댑터 완성 (PRD Q5) — `sources/polling-window-source.js` 에 자리는 있으나
      `get-windows` 미설치 상태라 실제로 돌려본 적이 없다
- [ ] 네이티브 헬퍼 코드서명 — 배포 시 Gatekeeper 대응 (Phase 5 패키징)
- [ ] 좌표 미세 조정 — 창이 화면 최상단(y≈0)이면 위 공간이 없어 캐릭터가 테두리 안쪽으로 내려앉는다
- [ ] 터미널 앱 화이트리스트 사용자 편집 UI
- [ ] 사용량 히스토리 그래프
- [ ] 캐릭터 커스터마이즈 / 스킨
