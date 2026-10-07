# PRD — Claude Code 데스크톱 캐릭터 위젯 (가칭 `claude-cs`)

- 문서 버전: 0.1
- 작성일: 2026-10-05
- 상태: 초안 (Phase 1 착수)

---

## 1. 개요

Claude Code 터미널 창 위에 상주하는 **투명 오버레이 데스크톱 캐릭터** 프로그램이다.
Claude Code의 토큰 사용량을 "밥"으로 비유해, 사용량이 늘어날수록 캐릭터가 **살이 찌고 둔해진다.**
사용자가 다른 창을 보고 있을 때 작업이 완료되면 화면 우측에서 **빼꼼** 나타나 알린다.

### 1.1 목표

| 구분 | 내용 |
| --- | --- |
| 핵심 가치 | 토큰 사용량이라는 추상적 수치를 캐릭터의 체형이라는 직관적 형태로 체감하게 한다 |
| 부가 가치 | 긴 작업 중 다른 창에 있어도 완료 시점을 놓치지 않는다 |
| 비목표 | Claude Code의 기능 대체, 터미널 에뮬레이터 구현, 사용량 과금 관리 |

### 1.2 기술 스택

| 영역 | 선택 | 비고 |
| --- | --- | --- |
| 런타임 | Electron | 투명/무테/AlwaysOnTop 오버레이 윈도우 |
| 창 추적 (macOS) | 상주 Swift 헬퍼 + `CGWindowList` | 자체 바이너리. 호출당 0.4ms, 외부 런타임 의존성 없음 |
| 창 추적 (Win/Linux) | `get-windows` (선택 의존성) | 어댑터 자리만 확보. 현재 미설치 |
| 렌더러 | HTML / CSS / JS (프레임워크 없음) | 스프라이트 애니메이션 위주라 번들러 불필요 |
| 설정 저장 | JSON 파일 (`app.getPath('userData')`) | 한도 모드 등 소수 항목 |
| 주 타깃 OS | macOS | Windows/Linux는 창 추적 어댑터 분리 후 대응 |

> **macOS 권한**: 필요 없다.
>
> `CGWindowList` 로 창의 **bounds·소유 pid** 만 읽고 **창 제목은 읽지 않는다.**
> 제목을 읽을 때만 화면 기록 권한이 필요하므로, 사용자는 아무 권한도 허용하지 않아도 된다.
> 제목이 필요해지는 시점(Phase 4 의 세션↔창 매핑 등)에 가서 다시 판단한다.

> **창 추적 성능** (Phase 1 실측)
>
> 처음에는 `get-windows` 를 주기 폴링했는데, 창을 드래그하면 눈에 띄게 버벅였다.
> 원인은 이 패키지가 **호출마다 헬퍼 프로세스를 새로 띄우는** 구조라는 것이었다.
>
> | 방식 | 1회 비용 | 60Hz 환산 CPU | 결과 |
> | --- | --- | --- | --- |
> | `get-windows` 폴링 | 36.8ms | 불가능 | 250ms 주기에도 CPU 15%, 초당 4회 갱신 |
> | 상주 Swift 헬퍼 | **0.376ms** | **~2.3%** | 유휴 실측 **0.1%**, 창 이동 중간 프레임까지 추적 |
>
> 헬퍼는 변화가 있을 때만 stdout 에 NDJSON 한 줄을 쓰고, 마지막 변화 후 2초간 60Hz,
> 그 뒤에는 5Hz 로 떨어지는 적응형 폴링을 한다. 유휴 시 전체 CPU 합계는 **0.4%** 로 측정됐다.
>
> **"맨 위 창이 누구냐"를 묻지 않는다.** CGWindowList 의 앞뒤 순서는 앱 전환 순간 수십 ms 동안
> 뒤집혔다 돌아오는 일이 있어서, 60Hz 로 읽으면 캐릭터가 깜빡인다. 그래서 활성 앱은
> `NSWorkspace` 활성화 **알림**(푸시)으로 받고, CGWindowList 는 그 앱의 창 bounds 를 찾는 데만 쓴다.
> 또 앱이 화면 밖에 숨겨 둔 보조 창을 집지 않도록, 화면에 실제로 걸쳐 있는 창만 본다.
>
> 덤으로 `get-windows` 를 걷어내면서 의존성이 160개 → 17개로 줄고, 수정 패치가 없던
> critical 취약점도 사라졌다 (npm audit 6건 → 0건).

---

## 2. 기능 요구사항

### 2.1 창 위치 추적 (Window Tracking)

| ID | 요구사항 |
| --- | --- |
| FR-01 | Active Window 를 주기적으로 폴링해, 터미널 앱인 경우 그 창의 좌표·크기를 얻는다 |
| FR-02 | 캐릭터는 추적 대상 창의 **상단 테두리 위**에 올라앉은 형태로 스폰된다 |
| FR-03 | 대상 창이 이동·리사이즈되면 캐릭터 오버레이도 같은 프레임 안에 따라 이동한다 |
| FR-04 | 대상 창이 최소화·종료되면 캐릭터를 숨긴다 (마지막 좌표는 기억) |
| FR-05 | 터미널이 아닌 앱이 활성화되면 캐릭터를 숨기고, "다른 창 보는 중" 상태로 전환한다 |
| FR-06 | 멀티 디스플레이에서 창이 다른 모니터로 이동해도 올바른 디스플레이 좌표계로 따라간다 |

**터미널 판정**: 앱 번들 ID / 실행 파일명 화이트리스트로 판정한다.
(예: `com.apple.Terminal`, `com.googlecode.iterm2`, `dev.warp.Warp-Stable`, `com.mitchellh.ghostty`,
`net.kovidgoyal.kitty`, `com.github.wez.wezterm`, `com.microsoft.VSCode`)
화이트리스트는 설정 파일로 사용자가 추가할 수 있어야 한다.

### 2.2 살찜(체형) 시스템

| ID | 요구사항 |
| --- | --- |
| FR-10 | 한도 기준을 **5시간 한도 / 주간 한도** 중 선택할 수 있다 (기본값: 5시간 한도) |
| FR-11 | 선택된 한도에 대한 사용률 `0~100%` 를 계산해 체형 단계로 매핑한다 |
| FR-12 | 단계 사이 전환은 급변이 아니라 보간(interpolation)으로 자연스럽게 연결한다 |
| FR-13 | 한도가 초기화되면 **트림 연출** 후 0%(홀쭉) 상태로 복귀한다 |

#### 체형 단계

| 사용률 | 체형 | 연출 |
| --- | --- | --- |
| 0~33% | 홀쭉함 | 쌩쌩함. 밥(토큰)을 신나게 먹는 모션 |
| 34~66% | 통통함 | 동작 속도 약간 감소 |
| 67~99% | 뚱뚱함 | 버겁게 움직임 + 헥헥거림 |
| 100% | 한계 | 터미널 위에 누워서 기절 + **리셋까지 남은 시간** 표시 |

- 100% 상태의 리셋 타이머는 **더 빨리 돌아오는 쪽(빠른 리셋 시간)** 기준으로 표시한다.
  (5시간 한도와 주간 한도가 모두 소진된 경우, 먼저 풀리는 창을 보여준다.)

### 2.3 상태별 행동

| ID | 상태 | 조건 | 행동 |
| --- | --- | --- | --- |
| FR-20 | `WORKING` | Claude Code 가 작업 중 | 토큰 소모 **속도에 비례**한 속도로 밥 먹는 모션 |
| FR-21 | `IDLE` | 3분간 입력·작업 없음 | 터미널 위에서 뒹굴며 휴식. 살찐 상태면 헥헥거림 추가 |
| FR-22 | `EXHAUSTED` | 사용률 100% | 누워서 기절 + 리셋 타이머 |
| FR-23 | `PEEK` | 다른 창 활성 + 작업 완료 | 화면 우측에서 빼꼼 출현 |

### 2.4 완료 알림 (빼꼼)

| ID | 요구사항 |
| --- | --- |
| FR-30 | 추적 대상 터미널이 **비활성**인 동안 작업 완료 이벤트가 발생하면 화면 우측 사이드에서 슬라이드 인 한다 |
| FR-31 | 빼꼼 창은 클릭 가능해야 하며, 클릭 시 **원래 터미널 창으로 포커스를 이동**시킨다 |
| FR-32 | 일정 시간(기본 20초) 무반응이면 스스로 사라진다 |
| FR-33 | 터미널이 다시 활성화되면 즉시 사라지고 캐릭터는 터미널 위 상태로 복귀한다 |
| FR-34 | 터미널이 활성인 상태에서 완료되면 빼꼼은 뜨지 않는다 (중복 알림 방지) |

---

## 3. 비기능 요구사항

| ID | 항목 | 기준 |
| --- | --- | --- |
| NFR-01 | CPU 점유 | 유휴 시 1% 미만. 창 추적 폴링은 기본 250ms, 유휴 시 자동으로 늘린다 |
| NFR-02 | 클릭 통과 | 오버레이는 기본적으로 마우스 이벤트를 통과시켜 터미널 조작을 방해하지 않는다 |
| NFR-03 | 포커스 비탈취 | 오버레이 윈도우는 절대 입력 포커스를 가져가지 않는다 |
| NFR-04 | 실패 가시성 | 창 추적·데이터 파싱 실패는 삼키지 않고 로그와 UI로 드러낸다 |
| NFR-05 | 데이터 안전성 | Claude Code 의 로컬 파일은 **읽기 전용**으로만 접근한다 |

---

## 4. 아키텍처

```
┌─────────────────────── Main Process ───────────────────────┐
│  app bootstrap                                             │
│  ├── WindowTracker      active-win 폴링 → 대상 창 bounds    │
│  ├── UsageMonitor       토큰 사용량·한도·리셋 시각 (Phase 2) │
│  ├── StateMachine       사용률·활동 → 캐릭터 상태 (Phase 3)  │
│  ├── OverlayWindow      터미널 위 캐릭터 (투명/무테/AOT)     │
│  └── PeekWindow         화면 우측 완료 알림 (Phase 4)        │
└──────────────────────────┬─────────────────────────────────┘
                           │ IPC (preload / contextBridge)
┌──────────────────────────┴─────────────────────────────────┐
│  Renderer: 캐릭터 스프라이트 · 체형 보간 · 모션 재생         │
└────────────────────────────────────────────────────────────┘
```

### 4.1 디렉터리 구조

```
claude-cs/
├── PRD.md
├── TASKS.md
├── package.json
├── native/
│   └── macos/
│       ├── window-watcher.swift  # 상주 창 감시 헬퍼 (CGWindowList)
│       └── bin/                  # 빌드 산출물 (gitignore)
├── scripts/
│   ├── build-native.mjs        # swiftc 빌드 (npm run build:native)
│   └── diag.mjs                # Phase 1 검증용 진단 (npm run diag)
└── src/
    ├── main/
    │   ├── index.js            # 앱 진입점·이벤트 배선
    │   ├── config.js           # 상수·터미널 화이트리스트
    │   ├── user-config.js      # userData/config.json 로더
    │   ├── sources/            # 창 소스 어댑터 (플랫폼별)
    │   │   ├── index.js            # 플랫폼 선택
    │   │   ├── macos-window-source.js   # 상주 헬퍼 구동·NDJSON 파싱
    │   │   └── polling-window-source.js # Win/Linux 폴백 (get-windows)
    │   ├── window-tracker.js   # 터미널 판정·상태 전이
    │   └── overlay-window.js   # 오버레이 윈도우 생성·좌표 계산
    ├── preload/
    │   └── overlay.cjs         # contextBridge (ESM 프로젝트라 .cjs)
    └── renderer/
        └── overlay/
            ├── index.html
            ├── overlay.css
            └── overlay.js
```

---

## 5. 개발 로드맵

| Phase | 목표 | 완료 기준 |
| --- | --- | --- |
| **1** | Electron 환경 + 창 추적 | 투명·무테·AlwaysOnTop 윈도우가 터미널 창 상단에 붙어 이동/리사이즈를 따라간다 |
| **2** | 사용량 데이터 | 토큰 사용량·한도 모드(5시간/주간)·리셋 시각을 읽어 `0~100%` 로 노출한다 |
| **3** | 상태 머신 | 체형 5단계 변화, 3분 Idle 감지, 100% 기절 + 리셋 타이머가 동작한다 |
| **4** | 빼꼼 알림 | 비활성 상태에서 완료 시 우측 빼꼼 + 클릭 시 터미널 포커스 복귀 |
| **5** | 에셋·연출 | 실제 캐릭터 에셋 적용, 리셋 시 트림 연출 |

---

## 6. 미해결 과제 (Open Questions)

| # | 항목 | 현재 판단 |
| --- | --- | --- |
| Q0 | ~~macOS 권한 모델~~ — **해소됨**: 권한 검사를 모두 끈 무권한 모드로 bundleId·bounds 획득 가능. title 만 포기한다 | Phase 1 에서 확정 |
| Q1 | **토큰 사용량 데이터 소스** | **조사 완료** → 아래 §7 참고. 정본 후보 확정, 채택 결정만 남음 |
| Q2 | ~~5시간·주간 한도의 절대값~~ — **불필요해짐**. statusLine payload 가 `used_percentage`(0~100) 를 직접 준다 | 해소 |
| Q3 | **작업 완료 이벤트 감지 방식** — Claude Code `Stop` 훅으로 IPC 전송 vs 트랜스크립트 tail 감시 | 훅 방식이 정확도·비용 모두 유리해 보임. Phase 4 에서 확정 |
| Q4 | ~~**캐릭터 에셋**~~ — **해소됨**: 생성 AI 로 원본을 만들고 `build-sheet.mjs` 가 시트로 굽는다. 행 = 체형 4단계, 열 = 프레임(몸 1 / 밥 먹기 8 / 뒹굴기 6 / 트림 6 / 기절 4) | Phase 5 에서 확정 |
| Q5 | Windows / Linux 지원 범위 | 1차는 macOS 전용. 창 추적 계층만 어댑터로 분리해 둔다 |
| Q6 | ~~의존성 취약점~~ — **해소됨**. 상주 Swift 헬퍼로 교체하며 `get-windows` 를 제거했다. 의존성 160개 → 17개, npm audit 6건(critical 1) → 0건 | Phase 1 에서 해소 |

---

## 7. Phase 2 사전 조사 결과 — 사용량 데이터 소스

Claude Code `v2.1.236` (Homebrew Cask) 기준 실측.

### 7.1 결론

**`statusLine` 훅 payload 가 유일한 공식 수치 소스다.** Claude Code 가 statusLine 커맨드의 stdin 으로
넘기는 JSON 에 다음이 들어 있다.

```jsonc
{
  "session_id": "string",
  "transcript_path": "string",
  "cwd": "string",
  "model": { "id": "string", "display_name": "string" },
  "version": "string",
  "context_window": {
    "total_input_tokens": 0,
    "total_output_tokens": 0,
    "context_window_size": 200000,
    "current_usage": { "input_tokens": 0, "output_tokens": 0,
                       "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0 },
    "used_percentage": 0,
    "remaining_percentage": 100
  },
  "rate_limits": {                 // Optional: 구독자 한정, 첫 API 응답 이후에만 존재
    "five_hour": { "used_percentage": 0, "resets_at": 0 },   // resets_at = Unix epoch seconds
    "seven_day": { "used_percentage": 0, "resets_at": 0 }
  }
}
```

- `five_hour` / `seven_day` 가 기획의 **5시간 한도 / 주간 한도**에 1:1 대응한다 (FR-10).
- `used_percentage` 가 0~100 이라 **체형 매핑에 그대로 쓸 수 있다** (FR-11). 한도 절대값을 알 필요가 없다.
- `resets_at` 이 각 윈도우마다 있으니 **빠른 리셋 시간**은 둘 중 min 으로 구한다 (§2.2).
- 리셋 감지는 `resets_at` 이 앞으로 점프하거나 `used_percentage` 가 급락하는 것으로 잡는다 (FR-13).

### 7.2 확인한 비(非)소스

| 후보 | 결과 |
| --- | --- |
| 트랜스크립트 `*.jsonl` | `message.usage` 에 토큰 상세(input/output/cache/thinking)는 있으나 **`rate_limits` 는 구조적으로 기록되지 않는다**. 전체 트랜스크립트를 훑어 확인함 |
| `~/.claude/policy-limits.json` | 이름과 달리 사용량과 무관. 조직 정책(웹검색 격리 등)만 들어 있다 |
| `~/.claude/telemetry/` | 전송 실패한 텔레메트리 이벤트 덤프. 사용량 소스 아님 |
| `~/.claude/.claude.json` / `settings.json` | 한도 수치 없음 |
| 디스크 캐시 | `rate_limits` 를 캐싱해 둔 파일이 **없다**. 프로세스 메모리에만 존재 |

### 7.3 설계상 제약

1. **statusLine 슬롯은 1개뿐이다.** `settings.json` 의 `statusLine` 은 배열이 아니라 단일 커맨드다.
   현재 이 머신에는 `Meokbo.app` 이 점유 중이라 그대로 덮어쓰면 기존 상태줄이 사라진다.
2. **훅(hooks)은 배열이라 공존 가능하다.** `Stop` / `StopFailure` / `SessionStart` 등은 여러 커맨드를
   나란히 등록할 수 있다. 다만 **훅 payload 에는 `rate_limits` 가 없다.**
3. `rate_limits` 는 **구독자 + 첫 API 응답 이후**에만 존재한다. 부재 상태를 정상 경로로 다뤄야 한다.
4. statusLine 은 Claude Code 가 상태줄을 다시 그릴 때만 호출된다. **폴링이 아니라 푸시**이고,
   갱신 주기는 우리가 정하지 못한다.

### 7.4 선택지

| 안 | 방식 | 장점 | 단점 |
| --- | --- | --- | --- |
| **A** | claude-cs 가 `statusLine` 을 차지하고, 받은 JSON 을 로컬 소켓으로 Electron 에 넘긴 뒤 **기존 상태줄 문자열을 그대로 출력**(Meokbo 커맨드를 래핑해 체인) | 공식 수치 확보 + 기존 상태줄 유지 | 남의 앱 커맨드를 감싸는 구조라 깨지기 쉽다. Meokbo 업데이트 시 재조정 필요 |
| **B** | claude-cs 가 `statusLine` 을 단독 차지 | 가장 단순하고 견고 | **Meokbo 상태줄이 사라진다.** 둘 중 하나를 포기해야 함 |
| **C** | `Stop` 등 훅만 쓰고 사용률은 트랜스크립트 토큰 합산으로 **추정** | statusLine 을 건드리지 않음 | 한도 절대값을 모르니 % 가 추정치. 기획의 "0~100%" 정확도를 포기 |
| **D** | 하이브리드 — 사용률은 A/B 로, 작업 완료·세션 이벤트는 훅으로 | 각 신호를 제일 정확한 경로에서 얻음 | 설정 항목이 늘어남 |

### 7.5 채택안 — **D (statusLine 단독 + 훅 병행)**

`Meokbo.app` 은 사용자의 이전 프로젝트 잔재이며 **이미 동작하지 않는다**
(프로세스 미실행, 훅·statusline 모두 출력 없이 exit 0). 보존할 상태줄이 없으므로
래핑하는 A 안은 복잡성만 남는다. 따라서 statusLine 은 **래핑 없이 단독 점유**한다.

| 신호 | 경로 | 쓰임 |
| --- | --- | --- |
| 사용률·리셋 시각 | `statusLine` payload 의 `rate_limits` | 체형 단계 (FR-11), 리셋 타이머 (FR-22), 리셋 감지 (FR-13) |
| 토큰 소모량·속도 | `statusLine` payload 의 `context_window` + 트랜스크립트 `usage` | 밥 먹는 모션 속도 (FR-20) |
| 작업 완료 | `Stop` 훅 | 빼꼼 알림 (FR-30) |
| 한도 소진 | `StopFailure` 훅 (matcher `rate_limit`) | 기절 전환 (FR-22) |
| 마지막 입력 시각 | `UserPromptSubmit` 훅 | 3분 Idle 판정 (FR-21) |
| 세션 수명 | `SessionStart` / `SessionEnd` 훅 | 세션↔터미널 창 매핑 (Phase 4) |

**D 를 택한 근거**: statusLine 은 Claude Code 가 상태줄을 다시 그릴 때만 호출되는 **푸시**이고
호출 시점을 우리가 정할 수 없다. 반면 빼꼼·기절·Idle 은 모두 "정확한 순간"이 필요하다.
그 순간은 훅만 제공한다. 반대로 `rate_limits` 는 훅 payload 에 없다. 그래서 두 경로 모두 필요하다.
훅은 배열이라 여러 커맨드가 공존할 수 있어, 나중에 다른 도구를 붙여도 claude-cs 가 길을 막지 않는다.

### 7.6 Meokbo 정리

| 항목 | 처리 |
| --- | --- |
| `settings.json` 의 Meokbo 훅 8개 + statusLine | Phase 2 에서 백업 후 claude-cs 항목으로 교체. 현재 툴 호출마다 빈 프로세스가 2번씩 뜨는 순수 오버헤드다 |
| `/Applications/Meokbo.app` | 삭제는 별도 확인 후. 설정만 정리하면 기능상 충분하다 |

> 세션 도중 전역 `settings.json` 을 고치면 실행 중인 Claude Code 세션의 훅 동작이 바뀐다.
> 그래서 claude-cs 항목을 넣는 시점에 **한 번에** 처리한다.
