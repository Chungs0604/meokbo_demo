# claude-cs

Claude Code 터미널 창 위에 올라앉는 **투명 오버레이 데스크톱 캐릭터**.

토큰 사용량을 "밥"으로 비유해, 사용량이 늘어날수록 캐릭터가 **살이 찌고 둔해진다.**
다른 창을 보고 있을 때 작업이 끝나면 화면 우측에서 **빼꼼** 나타나 알린다.

> 개발 중이다. 현재 Phase 3 까지 완료 — 터미널 창을 따라다니고, 사용량에 따라 체형이
> 바뀌며, 상태별로 밥 먹기·뒹굴기·기절 스프라이트가 재생된다.
> 한도가 리셋되면 트림하고 홀쭉해진다.
> 메뉴바 트레이에서 한도 기준을 바꾸고 종료한다 — 트레이 아이콘도 사용률만큼 차오른다.
> 빼꼼 알림(Phase 4), 리셋 타이머 UI·패키징(Phase 5)이 남았다.
> 진행 상황은 [TASKS.md](./TASKS.md) 를 본다.

## 요구 환경

- **macOS** — 주 타깃. Windows / Linux 는 어댑터 자리만 있고 미구현이다
- **Xcode Command Line Tools** — Swift 헬퍼 컴파일에 `swiftc` 가 필요하다
  (`xcode-select --install`)
- **Node.js + npm**
- **Claude Code** — 사용량 데이터를 훅으로 받는다

macOS 접근성·화면 기록 **권한은 필요 없다.** 창의 bounds 와 소유 pid 만 읽고 창 제목은
읽지 않는다.

검증 환경: macOS 26.6.2 (arm64), Node v25.8.2, Swift 6.3.3

## 설치

```bash
npm install
npm run hooks:install   # Claude Code 훅·statusLine 등록
npm start
```

**`hooks:install` 을 건너뛰면 사용량 데이터가 들어오지 않는다.** 훅 커맨드에 절대경로가
들어가 머신마다 달라지므로 `.claude/settings.json` 은 저장소에 커밋되지 않는다.
클론한 뒤 한 번 실행해야 한다.

등록된 훅은 이미 열려 있는 Claude Code 세션에 적용되지 않는다. **세션을 재시작**해야
수치가 들어온다.

실행하면 Dock 아이콘이 없다 (상주 오버레이라서). **설정과 종료는 메뉴바 트레이**에서 한다 —
한도 기준을 5시간 / 주간으로 바꿀 수 있고, 아이콘 자체가 사용률만큼 차오르는 게이지다.

전역 단축키 **`Control+Alt+Shift+Q`** 로도 종료된다. 메뉴바가 가려지는 전체화면에서는
이쪽이 유일한 수단이다. 터미널에서 띄웠다면 `Ctrl+C` 도 된다.

## 동작 방식

두 가지를 독립적으로 받아 합친다.

| | 무엇 | 어떻게 |
| --- | --- | --- |
| 위치 | 어느 터미널 창에 올라앉을지 | 상주 Swift 헬퍼(`window-watcher`)가 활성 창 변화를 알림. 호출당 0.4ms |
| 사용량 | 토큰을 얼마나 썼는지 | Claude Code 훅·statusLine 이 Swift 클라이언트(`hook-client`)를 거쳐 유닉스 소켓으로 밀어줌 |

사용률 수치는 Claude Code 의 statusLine payload 에 담긴 `rate_limits`(5시간 / 7일 창)를
그대로 쓴다. **`~/.claude` 를 뒤지거나 파일을 읽지 않는다.**

statusLine 도 함께 등록되어 `5h 20% · 7d 13%` 가 상태줄에 표시된다. 앱이 꺼져 있어도
상태줄은 정상 동작한다.

## 명령어

```bash
npm start              # 실행
npm run dev            # 디버그 로그 + 디버그 패널
npm run diag           # 좌표 계산·터미널 판정 진단 (렌더 없이)
npm run diag:capture   # 오버레이를 렌더해 PNG 캡처 (투명도 확인)
npm run diag:states    # 캐릭터 상태별 캡처 (밥 먹기 / 뒹굴기 / 기절 / 트림)
npm run test:usage     # UsageMonitor 단위 테스트
npm run build:native   # Swift 헬퍼 컴파일 (start/dev/diag 가 자동 실행)
npm run build:sheet    # 캐릭터 원본 프레임을 스프라이트 시트로 굽는다 (원본 필요)

npm run hooks:status     # 훅 등록 상태 확인
npm run hooks:uninstall  # 우리 항목만 선별 제거
```

훅은 기본적으로 **이 프로젝트에만** 등록된다. 상시 사용하려면 `-- --global` 을 붙여
`~/.claude/settings.json` 에 올린다 (한도는 계정 단위라 전역이 맞다).
설치·제거는 멱등이고 실행 전 자동으로 백업을 남긴다.

## 설정

`~/Library/Application Support/claude-cs/config.json` (없으면 기본값)

```json
{
  "limitMode": "5h",
  "extraTerminalBundleIds": [],
  "extraTerminalAppNames": []
}
```

- `limitMode` — `"5h"` 또는 `"weekly"`. 어느 한도를 기준으로 체형을 정할지
- `extraTerminal*` — 기본 화이트리스트에 없는 터미널 앱 추가. macOS 는 bundleId 를 쓴다
  (`osascript -e 'id of app "앱이름"'` 으로 확인)

기본 화이트리스트는 Terminal·iTerm2·Warp·Ghostty·kitty·WezTerm·Alacritty·Hyper·
VS Code·Cursor 다.

## 문서

- [PRD.md](./PRD.md) — 요구사항 정본. FR/NFR 번호와 데이터 소스 조사 결과(§7)
- [TASKS.md](./TASKS.md) — Phase 별 체크리스트와 진행 상황
- [VERIFY-PHASE1.md](./VERIFY-PHASE1.md) — Phase 1 수동 검증 체크리스트
- [CLAUDE.md](./CLAUDE.md) — Claude Code 작업용 저장소 가이드
