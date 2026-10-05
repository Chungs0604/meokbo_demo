import process from 'node:process';

export const DEBUG = process.env.CLAUDE_CS_DEBUG === '1';

/**
 * Windows / Linux 폴백 폴링 주기.
 * macOS 는 상주 Swift 헬퍼(native/macos/window-watcher.swift)가 자체적으로 적응형 폴링을 하므로
 * 이 값을 쓰지 않는다. get-windows 는 호출당 약 37ms 라 이보다 더 줄일 수 없다.
 */
export const POLL_INTERVAL_MS = 250;

/**
 * 캐릭터 오버레이 윈도우 크기.
 * 박스가 캐릭터 실제 높이보다 크면 위쪽에 빈 공간이 생겨, 창이 화면 상단 근처일 때
 * 불필요하게 화면 밖으로 밀려난다. 그래서 박스를 캐릭터 최대 크기에 맞춰 둔다.
 * 실제 에셋이 들어오는 Phase 5 에서 재조정한다.
 */
export const OVERLAY_SIZE = { width: 120, height: 84 };

/**
 * 캐릭터는 창 상단 테두리에 "올라앉은" 형태여야 한다 (FR-02).
 * 발이 테두리에 살짝 묻히도록 아래로 내리는 픽셀 수.
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

/** Dock 아이콘도 트레이도 없는 상태라 종료 수단이 필요하다. 트레이 메뉴는 Phase 5. */
export const QUIT_SHORTCUT = 'Control+Alt+Shift+Q';
