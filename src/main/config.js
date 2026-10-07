import process from 'node:process';

export const DEBUG = process.env.CLAUDE_CS_DEBUG === '1';

/**
 * Windows / Linux 폴백 폴링 주기.
 * macOS 는 상주 Swift 헬퍼(native/macos/window-watcher.swift)가 자체적으로 적응형 폴링을 하므로
 * 이 값을 쓰지 않는다. get-windows 는 호출당 약 37ms 라 이보다 더 줄일 수 없다.
 */
export const POLL_INTERVAL_MS = 250;

/**
 * 캐릭터 오버레이 윈도우 크기 = 스프라이트 시트의 셀 크기.
 *
 * Phase 1 플레이스홀더는 120x84 로 가로가 길었는데, 실제 캐릭터(토끼)는 귀 때문에
 * 세로로 길다(폭:높이 = 0.59). 그래서 비율이 뒤집혔다.
 * **scripts/build-sheet.mjs 의 CELL 과 반드시 같아야 한다.** 다르면 프레임이 잘린다.
 */
export const OVERLAY_SIZE = { width: 124, height: 92 };

/**
 * 캐릭터는 창 상단 테두리에 "올라앉은" 형태여야 한다 (FR-02).
 * 발이 테두리에 살짝 묻히도록 아래로 내리는 픽셀 수.
 * 스프라이트는 셀 바닥에서 4px(build-sheet 의 FOOT_MARGIN) 띄워져 있으므로,
 * 실제로 발이 테두리 아래로 묻히는 깊이는 이 값에서 4px 를 뺀 만큼이다.
 */
export const SIT_SINK_PX = 8;
/** 창 가로폭 기준 캐릭터 중심 위치 비율. 0 = 왼쪽 끝, 1 = 오른쪽 끝. */
export const SIT_ANCHOR_RATIO = 0.75;

/**
 * 터미널 판정 화이트리스트 (macOS: bundleId).
 * 사용자는 userData/config.json 의 extraTerminalBundleIds / extraTerminalAppNames 로 추가할 수 있다.
 */
export const TERMINAL_BUNDLE_IDS = [
  'com.apple.Terminal',
  'com.googlecode.iterm2',
  'dev.warp.Warp-Stable',
  'dev.warp.Warp-Preview',
  'com.mitchellh.ghostty',
  'net.kovidgoyal.kitty',
  'com.github.wez.wezterm',
  'io.alacritty',
  'co.zeit.hyper',
  'com.microsoft.VSCode',
  'com.microsoft.VSCodeInsiders',
  'com.todesktop.230313mzl4w4u92', // Cursor
];

/** Windows / Linux 용 폴백 판정 (프로세스·앱 이름, 소문자 부분 일치). */
export const TERMINAL_APP_NAMES = [
  'terminal',
  'iterm',
  'warp',
  'ghostty',
  'kitty',
  'wezterm',
  'alacritty',
  'hyper',
  'windowsterminal',
  'wt',
  'gnome-terminal',
  'konsole',
  'code',
  'cursor',
];

/**
 * get-windows 권한 옵션 (Windows / Linux 폴백 전용).
 * 두 플래그를 모두 false 로 두면 macOS 권한 부여 없이도 bundleId·bounds 를 얻을 수 있다.
 * 대신 title 은 항상 빈 문자열이다. Phase 1 은 title 이 필요 없으므로 무권한 모드를 기본으로 쓴다.
 * title 이 필요해지면(Phase 4 세션 매핑 등) screenRecordingPermission 을 켜고 권한을 안내한다.
 */
export const TRACKER_PERMISSIONS = {
  accessibilityPermission: false,
  screenRecordingPermission: false,
};

/** 한도 기준. 기본값은 5시간 한도다 (FR-10). */
export const LIMIT_MODES = ['5h', 'weekly'];
export const DEFAULT_LIMIT_MODE = '5h';

/** 이만큼 입력·작업이 없으면 Idle 로 본다 (FR-21). */
export const IDLE_AFTER_MS = 3 * 60 * 1000;

/** Dock 아이콘도 트레이도 없는 상태라 종료 수단이 필요하다. 트레이 메뉴는 Phase 5. */
export const QUIT_SHORTCUT = 'Control+Alt+Shift+Q';

/**
 * 사용률 → 체형 단계 경계 (PRD §2.2 체형 단계표: 0~33 / 34~66 / 67~99 / 100).
 * 표는 정수로 적혀 있지만 실제 `used_percentage` 는 소수로 온다
 * (Phase 2 실측: 28.999999999999996). 그래서 "미만" 기준으로 적는다.
 * 33.5% 는 홀쭉, 66.9% 는 통통이고, 100% 만 한계다.
 */
export const FATNESS_STAGES = [
  { stage: 'slim', below: 34 },     // 홀쭉함
  { stage: 'chubby', below: 67 },   // 통통함
  { stage: 'fat', below: 100 },     // 뚱뚱함
  { stage: 'limit', below: Infinity }, // 한계 (100%)
];

/** 이 사용률부터 기절한다 (FR-22). 체형 `limit` 단계와 같은 경계다. */
export const EXHAUSTED_PERCENTAGE = 100;

/**
 * 토큰 소모 속도를 내는 창 길이 (FR-20 평활화).
 *
 * statusLine 호출 간격이 불규칙해서 "직전 샘플과의 차이 / 그 간격" 으로 재면
 * 원값이 100배까지 튄다 (Phase 2 실측: 746 → 91920 → 16158, 최대 226971).
 * 간격이 짧을수록 분모가 작아져 증폭되는 게 원인이라, 분모를 고정하고
 * "최근 1분 동안 실제로 쓴 토큰 수" 를 그대로 속도로 쓴다. 정의도 직관적이다.
 */
export const TOKEN_RATE_WINDOW_MS = 60 * 1000;

/**
 * 밥 먹는 모션이 최고 속도가 되는 분당 토큰 수 (FR-20).
 * Phase 2 실측에서 평상시가 2k~12k, 압축 직후 피크가 수만이었다.
 * 2만을 상한으로 두면 일반 작업 구간에서 속도 변화가 눈에 들어온다.
 */
export const TOKENS_PER_MINUTE_FULL = 20000;

/**
 * UsageMonitor 자체 점검 주기. Idle 판정(FR-21)과 토큰 창 만료를 여기서 본다.
 * 둘 다 "3분" / "1분" 단위라 10초면 충분히 촘촘하고, 빈 타이머라 비용이 없다.
 */
export const TICK_INTERVAL_MS = 10 * 1000;

/**
 * 디버그 패널 자리로 오버레이 창을 **위로** 늘리는 높이.
 *
 * 창이 120x84 라 패널과 캐릭터가 같은 공간을 두고 싸운다. 디버그일 때만 창을 늘려
 * 패널에 자기 자리를 주고, 캐릭터는 원래 영역에 그대로 둔다.
 * 평상시(0)에는 창 크기와 좌표 계산이 Phase 1 과 완전히 같다.
 * 값은 패널 4~5줄(9px) 기준이다.
 */
export const DEBUG_PANEL_HEIGHT = DEBUG ? 58 : 0;
