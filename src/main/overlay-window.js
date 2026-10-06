import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, screen } from 'electron';
import {
  DEBUG,
  DEBUG_PANEL_HEIGHT,
  OVERLAY_SIZE,
  SIT_ANCHOR_RATIO,
  SIT_SINK_PX,
} from './config.js';

function debugLog(...args) {
  if (DEBUG) console.log('[overlay]', ...args);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD = path.join(here, '..', 'preload', 'overlay.cjs');
const PAGE = path.join(here, '..', 'renderer', 'overlay', 'index.html');

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * 대상 창 bounds → 캐릭터 오버레이 좌표.
 * 캐릭터는 창 상단 테두리 위에 올라앉는다 (FR-02).
 *
 * 클램프 기준은 workArea 가 아니라 display.bounds 다.
 * workArea 로 가두면 메뉴바·Dock 영역을 피하려고 캐릭터가 창에서 떨어져 나가는데,
 * 여기서는 "창에 붙어 있을 것"이 메뉴바를 피하는 것보다 중요하다.
 */
export function computeOverlayBounds(targetBounds) {
  const { width, height } = OVERLAY_SIZE;
  const centerX = targetBounds.x + Math.round(targetBounds.width * SIT_ANCHOR_RATIO);

  // 창이 걸쳐 있는 디스플레이를 찾아 그 좌표계 안에서 가둔다 (FR-06).
  const display = screen.getDisplayNearestPoint({
    x: Math.round(targetBounds.x + targetBounds.width / 2),
    y: Math.round(targetBounds.y),
  });
  const area = display.bounds;

  return {
    x: clamp(Math.round(centerX - width / 2), area.x, area.x + area.width - width),
    y: clamp(
      Math.round(targetBounds.y - height + SIT_SINK_PX),
      area.y,
      area.y + area.height - height,
    ),
    width,
    height,
  };
}

/**
 * 캐릭터 박스 → 실제 창 bounds.
 *
 * 디버그 패널이 캐릭터를 덮지 않도록 창을 위로 늘린다. 화면 위쪽에 자리가 없으면
 * 늘릴 수 있는 만큼만 늘리는데, **캐릭터 위치는 어떤 경우에도 바뀌면 안 되므로**
 * 실제로 늘어난 높이(topGap)를 렌더러에 알려 stage 를 그만큼 내리게 한다.
 * 평상시에는 DEBUG_PANEL_HEIGHT 가 0 이라 캐릭터 박스가 곧 창이다.
 */
export function computeWindowBounds(characterBounds) {
  if (!DEBUG_PANEL_HEIGHT) return { ...characterBounds, topGap: 0 };

  const display = screen.getDisplayNearestPoint({
    x: characterBounds.x + Math.round(characterBounds.width / 2),
    y: characterBounds.y,
  });
  const top = Math.max(display.bounds.y, characterBounds.y - DEBUG_PANEL_HEIGHT);
  const topGap = characterBounds.y - top;

  return {
    x: characterBounds.x,
    y: top,
    width: characterBounds.width,
    height: characterBounds.height + topGap,
    topGap,
  };
}

export class OverlayWindow {
  #win = null;
  #lastBounds = null;

  async create() {
    this.#win = new BrowserWindow({
      width: OVERLAY_SIZE.width,
      height: OVERLAY_SIZE.height + DEBUG_PANEL_HEIGHT,
      show: false,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      // 오버레이는 절대 입력 포커스를 가져가면 안 된다 (NFR-03).
      focusable: false,
      acceptFirstMouse: false,
      roundedCorners: false,
      // macOS 에서 panel 타입이어야 전체화면 앱 위에도 올라간다.
      type: process.platform === 'darwin' ? 'panel' : undefined,
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // 마우스 이벤트를 아래 터미널로 통과시켜 조작을 방해하지 않는다 (NFR-02).
    this.#win.setIgnoreMouseEvents(true, { forward: true });
    this.#win.setAlwaysOnTop(true, 'screen-saver');
    this.#win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    await this.#win.loadFile(PAGE);

    if (DEBUG) {
      // Electron 35+ 는 details 객체 하나로 넘긴다. 구 시그니처도 함께 받아둔다.
      this.#win.webContents.on('console-message', (first, _level, message) => {
        console.log('[renderer]', message ?? first?.message ?? first);
      });
    }
  }

  get isAlive() {
    return Boolean(this.#win) && !this.#win.isDestroyed();
  }

  /** 대상 창 위로 위치를 맞추고 보이게 한다 (FR-03). */
  syncToTarget(target) {
    if (!this.isAlive) return;

    const bounds = computeOverlayBounds(target.bounds);
    const { topGap, ...windowBounds } = computeWindowBounds(bounds);
    const moved = !this.#lastBounds
      || this.#lastBounds.x !== windowBounds.x
      || this.#lastBounds.y !== windowBounds.y
      || this.#lastBounds.height !== windowBounds.height;

    if (moved) {
      this.#win.setBounds(windowBounds);
      this.#lastBounds = windowBounds;
    }

    const wasVisible = this.#win.isVisible();
    if (!wasVisible) {
      this.#win.showInactive();
    }
    debugLog(
      `sync target=${JSON.stringify(target.bounds)} -> overlay=${JSON.stringify(bounds)}`,
      `moved=${moved} wasVisible=${wasVisible} nowVisible=${this.#win.isVisible()}`,
      `actualBounds=${JSON.stringify(this.#win.getBounds())}`,
    );

    this.send('overlay:state', {
      visible: true,
      target: {
        appName: target.appName,
        bundleId: target.bundleId,
        bounds: target.bounds,
      },
      overlayBounds: bounds,
      // 렌더러가 캐릭터를 패널 아래로 내리는 데 쓴다 (디버그가 아니면 0).
      topGap,
    });
  }

  hide(reason) {
    if (!this.isAlive) return;
    if (this.#win.isVisible()) {
      debugLog(`hide reason=${reason}`);
      this.#win.hide();
    }
    this.send('overlay:state', { visible: false, reason });
  }

  /** 렌더링 결과 확인용. scripts/diag.mjs 가 쓴다. */
  capturePage() {
    if (!this.isAlive) {
      throw new Error('오버레이 윈도우가 없다.');
    }
    return this.#win.webContents.capturePage();
  }

  send(channel, payload) {
    if (!this.isAlive) return;
    this.#win.webContents.send(channel, payload);
  }

  destroy() {
    if (this.isAlive) {
      this.#win.destroy();
    }
    this.#win = null;
  }
}
