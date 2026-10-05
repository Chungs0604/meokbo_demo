import process from 'node:process';
import { app, globalShortcut } from 'electron';
import { DEBUG, QUIT_SHORTCUT } from './config.js';
import { loadUserConfig, configPath } from './user-config.js';
import { OverlayWindow } from './overlay-window.js';
import { WindowTracker } from './window-tracker.js';
import { createWindowSource } from './sources/index.js';

// 두 개 돌면 캐릭터가 겹쳐 보인다.
if (!app.requestSingleInstanceLock()) {
  console.error('[app] 이미 실행 중인 인스턴스가 있다. 종료한다.');
  app.quit();
  process.exit(0);
}

let overlay = null;
let tracker = null;
/** 폴링마다 같은 에러를 쏟지 않도록 직전 메시지를 기억한다. */
let lastTrackerErrorMessage = null;

function log(...args) {
  if (DEBUG) console.log(...args);
}

async function bootstrap() {
  // 상주형 오버레이라 Dock 에 자리를 차지할 이유가 없다.
  app.dock?.hide();

  const userConfig = loadUserConfig();
  log('[app] userData config:', configPath());

  overlay = new OverlayWindow();
  await overlay.create();

  tracker = new WindowTracker(await createWindowSource(), userConfig);

  tracker.on('target', (target) => {
    log('[tracker] target', target.appName, target.bounds);
    overlay.syncToTarget(target);
  });

  tracker.on('target-lost', (reason) => {
    log('[tracker] lost:', reason);
    overlay.hide(reason);
  });

  tracker.on('error', (error) => {
    if (error.message === lastTrackerErrorMessage) return;
    lastTrackerErrorMessage = error.message;
    console.error('[tracker] 창 추적 실패:', error.message);
  });

  tracker.start();

  // Dock·트레이가 없어 종료할 방법이 필요하다. 트레이 메뉴는 Phase 5.
  if (globalShortcut.register(QUIT_SHORTCUT, () => app.quit())) {
    console.log(`[app] 종료 단축키: ${QUIT_SHORTCUT}`);
  } else {
    console.error(`[app] 종료 단축키(${QUIT_SHORTCUT}) 등록 실패. 터미널에서 Ctrl+C 로 종료한다.`);
  }
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error('[app] 부트스트랩 실패:', error);
  app.quit();
});

app.on('second-instance', () => {
  console.error('[app] 두 번째 인스턴스 실행 시도를 무시했다.');
});

// 오버레이는 숨겨질 뿐 닫히지 않는다. 창이 없어도 앱은 살아 있어야 한다.
app.on('window-all-closed', () => {});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  tracker?.stop();
  overlay?.destroy();
});
