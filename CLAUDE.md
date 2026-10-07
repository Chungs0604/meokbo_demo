# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

Claude Code 토큰 사용량에 따라 살이 찌는 데스크톱 캐릭터 오버레이. Electron + 바닐라 JS,
창 추적과 훅 수신은 Swift 네이티브 헬퍼가 담당한다. macOS 전용으로 개발 중이다.

## 문서 역할

- `PRD.md` — 요구사항 정본. **FR-xx / NFR-xx 번호가 코드 주석에서 직접 인용된다.**
  §7 은 사용량 데이터 소스 조사 결과와 채택 근거다
- `TASKS.md` — Phase 별 체크리스트 겸 진행 상황. 작업이 끝나면 체크박스와 실측값을 갱신한다.
  미검증 항목은 `[ ]` 로 남기고 왜 못 했는지 적는다
- `VERIFY-PHASE1.md` — 수동(육안) 검증 체크리스트

코드를 고칠 때 관련 FR 번호를 주석에 남기는 관습을 따른다. 설계 결정의 **근거**는
커밋 본문이 아니라 `TASKS.md` 항목이나 코드 주석에 적는다.

## 명령어

```bash
npm start          # 실행 (prestart 가 네이티브 자동 빌드)
npm run dev        # CLAUDE_CS_DEBUG=1 — [tracker]/[usage]/[hook]/[overlay] 로그 + 디버그 패널
npm run diag       # Electron 띄워 좌표 계산·터미널 판정 검증 (렌더 없이)
npm run diag:capture  # 오버레이를 실제로 렌더해 PNG 캡처 (투명도 확인용)
npm run diag:fatness  # 체형 보간(늘어남·줄어듦) 구간을 연속 캡처
npm run diag:states   # 캐릭터 상태별 캡처 (WORKING / IDLE / EXHAUSTED + 뚱뚱한 WORKING)
npm run test:usage # UsageMonitor 단위 테스트 (Electron 불필요)
npm run build:native  # Swift 헬퍼 2개 컴파일. 소스가 더 새로울 때만 재빌드
npm run build:sheet   # assets/raw/ 의 생성 AI 격자를 스프라이트 시트로 굽는다
npm run build:tray    # body.png 에서 메뉴바 트레이 아이콘(체형 4단계)을 굽는다

npm run inject -- 75           # 디버그용 사용률 주입 (진짜 statusLine 과 같은 경로)

npm run hooks:install    # Claude Code 훅·statusLine 등록 (.claude/settings.json)
npm run hooks:status     # 등록 상태 확인
npm run hooks:uninstall  # 우리 항목만 선별 제거
#  -- --global 을 붙이면 ~/.claude/settings.json 에 적용된다
```

**테스트 러너는 직접 만든 스크립트다** (`scripts/test-usage.mjs`). 프레임워크가 없어 개별
테스트만 골라 돌리는 기능은 없다. 단일 케이스를 보려면 파일을 직접 편집하거나
`node -e` 로 `UsageMonitor` 를 import 해서 쓴다. 테스트 프레임워크·린터는 **의도적으로 없다**
(런타임 의존성 0개 유지 — `npm audit` 0건이 Phase 1 의 산출물이다).

## 아키텍처

독립적인 두 데이터 흐름이 `src/main/index.js` 에서만 만난다.

### 1. 창 추적 — "캐릭터를 어디에 둘지"

```
window-watcher (Swift, 상주)  →  MacOSWindowSource  →  WindowTracker  →  OverlayWindow
   NDJSON 한 줄/변화               sample 이벤트         target 이벤트      setBounds
```

- **소스 어댑터 계약**: `src/main/sources/*` 는 모두 `sample`(payload 또는 `null`) / `error`
  두 이벤트만 방출한다. `createWindowSource()` 가 플랫폼을 보고 고르며, 비 macOS 폴백은
  선택 의존성이라 **동적 import** 한다
- `WindowTracker` 는 폴링을 하지 않는다. 터미널 판정과 상태 전이(`target` / `target-lost`)만 본다
- 터미널 판정은 macOS 에서 **bundleId 가 정본**이고, bundleId 가 있으면 이름 폴백을 타지 않는다
  (`config.js` 의 `TERMINAL_BUNDLE_IDS`, 사용자는 `userData/config.json` 으로 추가)

### 2. 사용량 — "캐릭터가 얼마나 살이 쪘는지"

```
Claude Code ──훅/statusLine──→ hook-client (Swift, 1회성) ──Unix socket──→ IpcServer → UsageMonitor
```

- **수치(`rate_limits`)는 statusLine payload 에만 들어온다. 훅 payload 에는 없다.**
  반대로 "작업이 끝난 정확한 순간"은 훅만 안다. 그래서 둘 다 받는다 (PRD §7.5)
- **파일을 읽지 않는다.** 훅이 밀어주는 데이터만 쓴다 (NFR-05). `~/.claude` 를 뒤지는 코드를
  추가하지 않는다
- 소켓은 `userData/ipc.sock`. 훅은 한 줄 쓰고 즉시 끊으며 응답을 기다리지 않는다
- 소켓 서버가 안 열려도 창 추적은 계속된다 (사용량만 못 받는 상태로 동작)

### 오버레이 윈도우의 불변 조건

`OverlayWindow` 의 생성 옵션은 대부분 NFR 을 직접 구현한 것이다. 건드릴 때 근거를 확인한다.

- `focusable: false` — 입력 포커스를 절대 가져가지 않는다 (NFR-03)
- `setIgnoreMouseEvents(true, { forward: true })` — 클릭 통과 (NFR-02)
- `type: 'panel'` + `alwaysOnTop('screen-saver')` — 전체화면 앱 위에도 올라간다
- 좌표 클램프는 `workArea` 가 아니라 `display.bounds` 기준이다. workArea 로 가두면
  메뉴바를 피하려다 캐릭터가 창에서 떨어져 나간다
- 오버레이는 숨겨질 뿐 **닫히지 않는다**. `window-all-closed` 는 의도적으로 빈 핸들러다

### 렌더러

`preload/overlay.cjs` 가 `contextBridge` 로 **수신 채널만** 노출한다 (sandbox 유지).
렌더러가 main 을 호출하는 경로는 없다. 채널은 셋이다 — `overlay:state`(위치·표시),
`overlay:usage`(체형·소모 속도), `overlay:character`(행동 상태).

**판단은 전부 main 이 하고 렌더러는 그리기만 한다.** 체형(`fatness`), 밥 먹는 세기(`intake`),
행동 상태(`StateMachine`) 모두 main 에서 계산해 내려보낸다. 렌더러는 sandbox + CSP `'self'`
라 ESM import 가 없어 모듈을 공유할 수 없고, main 에 두면 Electron 없이 단위 테스트가 된다.

렌더러가 자기 판단으로 하는 일은 **리셋 카운트다운 하나**다. statusLine 은 Claude Code 가
화면을 그릴 때만 호출되므로 기절해 있는 동안에는 새 수치가 오지 않는다. 받아둔
`nextResetAt` 으로 직접 시계를 돌리는 수밖에 없다.

캐릭터는 스프라이트 시트다 (`renderer/overlay/assets/*.png`). 체형은 `--fatness`(0~1),
밥 먹는 속도는 `--intake`(0~1), 상태는 `data-character`, 체형 단계는 `data-stage` 로 받는다.
`--fatness` 같은 합성 변수를 쓰는 선언은 **그 변수가 보이는 위치에 두어야 한다** —
미등록 커스텀 프로퍼티는 선언된 요소에서 값이 굳어 내려오기 때문에, `:root` 에 선언한
`--eat-duration` 은 `.stage` 에 꽂은 `--slow` 를 보지 못한다.

### 스프라이트 렌더링

시트 규약은 **행 = 체형 단계(`config.js` 의 `FATNESS_STAGES` 순서), 열 = 프레임**이다.
JS 가 `--row` 로 행을 고르고, CSS 가 상태별로 시트와 `--columns` 를 갈아끼운다 —
`body`(1열, 정지) / `eat`(8열) / `roll`(6열) / `burp`(6열) / `faint`(4열).

- **프레임 재생은 모션 공용 `@keyframes frames` 하나다.** 열을 한 칸씩 밀기만 하므로
  새 모션을 붙일 때는 시트와 `--columns`·`steps()` 숫자만 주면 된다
- **한 번만 재생하는 모션은 키프레임 이름을 따로 써야 한다** (`frames-once`).
  이름이 같으면 돌고 있던 애니메이션이 **시작 시각을 유지한 채 이어져서**, 밥 먹다
  리셋되면 트림이 이미 끝난 상태로 시작한다 (`diag:states` 캡처가 첫 칸에 멈춰 있었다)
- **트림 길이는 두 곳에 박혀 있다.** `config.js` 의 `BURP_DURATION_MS` 와 `overlay.css` 의
  `1.8s` 다. main 이 타이머로 상태를 되돌리므로 어긋나면 연출이 잘리거나 멈춰 선다
- **`animation` 은 하나의 목록이라 한쪽을 따로 선언하면 다른 쪽이 지워진다.** 프레임 재생과
  헥헥거림이 그래서 `--anim-frames` / `--anim-pant` 로 자리를 나눠 갖는다.
  (스프라이트 교체 때 헥헥거림이 한 번 사라진 적이 있다)
- **체형 보간(FR-12)은 레이어 2장 크로스페이드다.** 그림이 4단계뿐이라 폭을 연속으로 늘리는
  방식을 쓸 수 없다. 새 레이어를 페이드 인 시킬 때 **이전 레이어도 같이 지워야 한다** —
  안 지우면 실루엣이 달라 옛 몸이 비쳐 두 겹으로 보인다 (줄어들 때만 드러난다)
- 누운 자세(`IDLE`/`EXHAUSTED`)는 통통 튀는 `bob` 을 끈다. 움직임은 프레임이 담당한다

## 함정

- **`.claude/settings.json` 은 `.gitignore` 에 있다.** 훅 커맨드에 절대경로가 들어가
  머신마다 다르기 때문이다. 새로 클론하면 `npm run hooks:install` 을 먼저 실행해야
  사용량 데이터가 들어온다
- **`assets/raw/` 도 `.gitignore` 에 있다.** 생성 AI 원본이 59MB 라 구운 시트만 커밋한다.
  즉 **클론한 저장소에서는 시트를 다시 구울 수 없다** — 스케일이나 셀 크기를 바꾸려면
  원본이 필요하다 (백업: `~/Desktop/meokbo-image/`). 양쪽을 지우지 않는다
- **`nativeImage.resize()` 는 알파를 날린다** (결과의 91%가 불투명해졌다). 시트를 구울 때는
  `build-sheet.mjs` 가 직접 구현한 알파 가중 박스 필터를 쓴다. `resize()` 로 되돌리지 않는다
- **생성 AI 는 "프레임을 충분히 띄워라"라고 해도 캔버스의 0.9% 까지 붙여 준다.**
  새 에셋을 요청할 때는 **간격을 캔버스 폭의 10% 이상으로 수치를 박아** 말한다
- **격자 칸은 행·열 히스토그램이 아니라 2차원 연결 덩어리로 센다.** 투영만 보면
  서로 **닿지도 않은** 그림이 한 칸으로 붙는다 — 트림 구름이 옆 칸 캐릭터와 x 범위가
  겹쳐서 2x3 격자가 4칸으로 잡혔다. 칸은 사각형이라 서로 겹칠 수 있으므로,
  자를 때 **다른 덩어리 픽셀을 지우고** 가져온다 (안 지우면 옆 칸 구름 부스러기가 묻는다).
  큰 덩어리를 고르는 기준은 중앙값이 아니라 **최댓값**이다 — 파리처럼 조각이 수십 개면
  중앙값이 잡티 쪽으로 쏠린다 (실측: 155덩어리 격자에서 4칸 대신 16칸)
- **한 모션의 프레임 수는 체형 4단계가 모두 같아야 한다.** CSS 가 모션당 `--columns` 하나와
  `steps()` 하나를 쓰기 때문이다. 생성 AI 가 3x3(9칸)을 내놓으면 6칸만 골라
  `<체형>-<번호>.png` 낱장으로 저장한다 (격자 파일과 낱장을 같은 체형에 두면 둘 다 읽힌다)
- **셀 높이와 폭은 제약이 다르다.** 높이는 창 배치가 묶어서 94px 가 상한이다 (넘으면 메뉴바
  아래 터미널에서 캐릭터가 창 안으로 파고든다, `npm run diag` 실측). 폭은 제약이 없어
  누운 자세를 위해 124px 로 넓혔다 — **누운 포즈의 크기는 사실상 셀 폭이 정한다.**
  높이를 `CHAR_HEIGHT` 에 맞추면 뒹굴기가 213px 까지 벌어져 어차피 폭 상한에 걸리기 때문이다
  (104px 일 때 서 있는 모션 대비 면적이 뒹굴기 65% / 기절 76% 였다, 불투명 픽셀 실측).
  `config.js` 의 `OVERLAY_SIZE` 와 `build-sheet.mjs` 의
  `CELL`, `overlay.css` 의 `--cell-w` 는 **셋 다 같아야 한다**
- **트레이 아이콘은 macOS 템플릿 이미지라 색이 없다 — 검정 + 알파뿐이다.**
  그래야 OS 가 다크 모드에서 흰색으로 자동 반전해 준다. 색을 넣으면 반전이 막혀
  검은 배경에 묻힌다. `setTemplateImage(true)` 를 빼도 같은 일이 생긴다.
  `@2x` 는 파일명 규약이라 `nativeImage` 가 알아서 찾는다 (레티나에서 실제로 쓰이는 건 32px 쪽이다)
- **트레이의 체형 단계는 실루엣 폭이 아니라 '채움'으로 구분한다.** 원본 그림의 chubby 와
  fat 은 몸통 폭이 둘 다 117px 로 같아서(높이만 7px 차이) 폭에 기대면 메뉴바에서
  뒤 세 단계가 한 그림이 된다. 채움 기준도 몸통 bbox 가 아니라 **배 구간**이어야 한다 —
  bbox 위쪽 1/3 이 가느다란 목·귀라 67% 만 채워도 fat 과 limit 이 같아 보인다
- **`build-tray.mjs` 의 입력은 커밋된 `body.png` 다.** `assets/raw/` 와 달리 저장소에
  들어 있으므로 클론한 곳에서도 다시 구울 수 있다. 생성 AI 원본을 다시 찾지 않는다
- **앱을 재시작하면 `UsageMonitor` 의 누적 상태가 사라진다.** 리셋 감지는 메모리에 든 이전
  샘플과 비교하는 방식이라(`resets_at` 전진 또는 사용률 급락), 재시작 직후 첫 샘플에는
  `reset` 이벤트가 뜨지 않는다. 리셋 전후를 검증할 때 앱을 건드리지 않는다
- **`tokensPerMinute` 는 "최근 1분간 쓴 토큰 수" 다.** 직전 샘플과의 차이를 간격으로 나누는
  방식은 statusLine 호출 간격이 불규칙해 원값이 100배까지 튀었다 (실측 최대 226971).
  분모를 고정한 슬라이딩 창으로 바꿨으니 **다시 간격으로 나누지 않는다**
- **사용량은 Claude Code 가 statusLine 을 그릴 때만 들어온다.** 폴링이 없어서, Claude Code 를
  안 쓰는 동안은 수치가 그대로 멈춰 있다. 리셋도 리셋 시각이 아니라 그 다음 statusLine 에
  알게 된다. 시각에 맞춰 뭔가 해야 하면 받아둔 `nextResetAt` 으로 직접 세야 한다
- **macOS Space(데스크톱) 전환 중 캐릭터가 잠깐 스쳐 보인다. 고치려 하지 마라 — 세 가지를
  이미 해봤고 전부 실패했다.** 오버레이가 `screen-saver` 레벨이라 전환 애니메이션 위에
  고정돼 뜨는 것이 원인으로 보인다. 시도한 것:
  1. `setVisibleOnAllWorkspaces(false, …)` — Space 소속을 터미널 쪽으로 한정. 변화 없음
  2. `alwaysOnTop` 레벨을 `screen-saver` → `floating` — 변화 없음.
     게다가 전체화면 앱 위로 올라가는 성질을 잃는다
  3. 헬퍼가 `NSWorkspace.activeSpaceDidChangeNotification` 을 받아 즉시 숨기기 —
     변화 없음. **이 알림은 전환이 끝난 뒤에 온다**
  전환 시작 시점을 알려주는 공개 API 가 없어 현재 구조로는 해결 수단이 없다.
  기능에는 영향이 없는 약 0.3초짜리 시각적 artifact 다
- Dock 아이콘이 없다. **설정을 건드릴 입구는 메뉴바 트레이뿐이다** — 한도 모드 전환(FR-10)과
  종료가 거기 있다. 전역 단축키 `Control+Alt+Shift+Q` 도 남겨 둔다. 메뉴바가 가려지는
  전체화면에서는 그쪽이 유일한 종료 수단이다.
  단일 인스턴스 락이 걸려 있어 두 번째 실행은 즉시 종료된다
- `PreToolUse` / `PostToolUse` 훅은 쓰지 않는다. 툴 호출마다 돌아 Claude Code 를 느리게 한다
  (제거한 선행 도구가 그렇게 약 9ms 를 낭비하고 있었다)
- 훅 클라이언트가 Swift 인 이유는 **statusLine 이 렌더링마다 호출**되기 때문이다.
  Node 는 기동만 43ms, 네이티브는 3.1ms. 이 경로에 Node 를 넣지 않는다

## 코드 규약

관찰된 기존 패턴이다. 새 패턴을 도입할 때는 이유를 말한다.

- ESM (`"type": "module"`). 네이티브 빌드·훅 스크립트는 `scripts/*.mjs`,
  preload 만 `.cjs` (sandbox 프리로드 제약)
- 클래스는 `#private` 필드 + `EventEmitter` 상속. 공개 표면은 이벤트와 getter 로 좁게 둔다
- 매직 넘버는 `src/main/config.js` 에 상수로 올리고 왜 그 값인지 주석을 남긴다
- 에러를 삼키지 않는다. 복구 가능하면 `error` 이벤트로 올리고, 아니면 `console.error` 로
  드러낸다. 반복되는 에러는 직전 메시지를 기억해 중복만 억제한다
  (`index.js` 의 `lastTrackerErrorMessage`)
- 디버그 로그는 `DEBUG`(`CLAUDE_CS_DEBUG=1`) 가드 뒤에 둔다. 사용자가 봐야 할 메시지만
  무조건 출력한다
