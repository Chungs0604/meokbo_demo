import process from 'node:process';
import { app, globalShortcut } from 'electron';
import { BURP_DURATION_MS, DEBUG, DEFAULT_LIMIT_MODE, QUIT_SHORTCUT } from './config.js';
import { loadUserConfig, saveUserConfig, configPath } from './user-config.js';
import { OverlayWindow } from './overlay-window.js';
import { WindowTracker } from './window-tracker.js';
import { createWindowSource } from './sources/index.js';
import { IpcServer } from './ipc-server.js';
import { UsageMonitor } from './usage-monitor.js';
import { StateMachine } from './state-machine.js';
import { TrayController } from './tray.js';

// 두 개 돌면 캐릭터가 겹쳐 보인다.
if (!app.requestSingleInstanceLock()) {
  console.error('[app] 이미 실행 중인 인스턴스가 있다. 종료한다.');
  app.quit();
  process.exit(0);
}

let overlay = null;
let tracker = null;
let ipcServer = null;
let usage = null;
let character = null;
let tray = null;
/** 폴링마다 같은 에러를 쏟지 않도록 직전 메시지를 기억한다. */
let lastTrackerErrorMessage = null;
/** 트림 연출을 끝낼 타이머. StateMachine 은 타이머를 들지 않는다 (FR-13). */
let burpTimer = null;
/**
 * 트림 연출 동안 붙잡아 둔 사용량 스냅샷 (FR-13).
 *
 * 리셋은 `reset` 다음 줄에서 0% 짜리 `usage` 를 바로 내보낸다. 그대로 흘려보내면
 * 체형이 트림과 **동시에** 줄어서 "트림 연출 후 복귀" 가 아니라 한 동작으로 뭉개진다.
 * 연출이 끝날 때 마지막 것 하나만 보낸다 — 중간 값들은 어차피 화면에 못 들어간다.
 */
let heldUsage = null;

function log(...args) {
  if (DEBUG) console.log(...args);
}

/**
 * 한도 리셋 트림 연출 (FR-13).
 *
 * 연출이 끝나면 붙잡아 둔 사용률을 흘려보내 홀쭉한 몸으로 넘어간다.
 * 리셋이 연달아 오면(5시간·주간이 같은 샘플에서 함께 넘어가는 경우) 타이머를 다시 건다.
 */
function startBurp() {
  character.startBurp();
  clearTimeout(burpTimer);
  burpTimer = setTimeout(() => {
    burpTimer = null;
    character.endBurp();
    if (heldUsage) {
      log('[usage] 트림 끝. 붙잡아 둔 체형을 내보낸다:', heldUsage.stage);
      overlay.send('overlay:usage', heldUsage);
      heldUsage = null;
    }
  }, BURP_DURATION_MS);
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
    character.setVisible(true);
  });

  tracker.on('target-lost', (reason) => {
    log('[tracker] lost:', reason);
    overlay.hide(reason);
    character.setVisible(false);
  });

  tracker.on('error', (error) => {
    if (error.message === lastTrackerErrorMessage) return;
    lastTrackerErrorMessage = error.message;
    console.error('[tracker] 창 추적 실패:', error.message);
  });

  // 캐릭터 상태는 창 추적과 사용량을 둘 다 봐야 정해진다. 그래서 tracker.start() 전에 만든다.
  character = new StateMachine();
  character.on('change', ({ state, previous, reason }) => {
    log(`[character] ${previous} → ${state} (${reason})`);
    overlay.send('overlay:character', { state, previous, reason });
  });

  tracker.start();

  // --- 사용량 (Phase 2) ---
  usage = new UsageMonitor(userConfig.limitMode ?? DEFAULT_LIMIT_MODE);

  // --- 트레이 (Phase 5) ---
  tray = new TrayController(usage.limitMode);
  tray.on('limit-mode', (mode) => {
    usage.setLimitMode(mode);   // 사용률 기준이 바뀌므로 즉시 다시 내보낸다 (FR-10)
    tray.setLimitMode(mode);
    try {
      saveUserConfig({ limitMode: mode });
      log('[config] 한도 모드 저장:', mode);
    } catch (error) {
      // 저장만 실패한 것이라 이번 실행은 그대로 쓴다. 다음 실행에서 되돌아갈 뿐이다.
      console.error('[config] 한도 모드를 저장하지 못했다:', error.message);
    }
  });
  tray.create();

  usage.on('usage', (snapshot) => {
    log('[usage]', JSON.stringify(snapshot));
    if (burpTimer) heldUsage = snapshot;
    else overlay.send('overlay:usage', snapshot);
    // 상태 판정은 미루지 않는다. 체형만 늦게 보일 뿐 기절·복귀는 제때 갈려야 한다.
    character.setUsage(snapshot);
    // 트레이는 트림과 무관하다. 연출 때문에 메뉴바 수치까지 멈출 이유가 없다.
    tray.setUsage(snapshot);
  });
  usage.on('reset', ({ mode }) => {
    log('[usage] 한도 리셋:', mode);
    character.clearExhausted();   // 한도가 풀려야 기절에서 깨어난다 (FR-13)
    startBurp();
  });
  usage.on('complete', ({ sessionId }) => log('[usage] 작업 완료:', sessionId));
  usage.on('exhausted', ({ resetsAt }) => {
    log('[usage] 한도 소진. 리셋:', resetsAt);
    character.markExhausted();
  });
  usage.start();

  ipcServer = new IpcServer();
  ipcServer.on('hook', (message) => {
    log('[hook]', message.event);
    usage.handleHook(message);
  });
  ipcServer.on('error', (error) => console.error('[ipc]', error.message));

  try {
    await ipcServer.start();
    log('[ipc] 수신 대기:', ipcServer.socketPath);
  } catch (error) {
    // 소켓을 못 열어도 창 추적은 계속돼야 한다. 사용량만 못 받는 상태로 동작한다.
    console.error('[ipc] 소켓 서버를 열지 못했다:', error.message);
  }

  // 트레이 메뉴에도 종료가 있지만, 메뉴바가 가려지는 전체화면에서는 단축키가 유일한 수단이다.
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
  tray?.destroy();
  tracker?.stop();
  usage?.stop();
  ipcServer?.stop();
  overlay?.destroy();
});
