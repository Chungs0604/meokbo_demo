import { EventEmitter } from 'node:events';
import process from 'node:process';
import { screen } from 'electron';
import { POLL_INTERVAL_MS, TRACKER_PERMISSIONS } from '../config.js';

/**
 * Windows / Linux 폴백. get-windows 를 주기적으로 호출한다.
 *
 * macOS 에서는 쓰지 않는다. get-windows 는 호출마다 헬퍼 프로세스를 띄워 1회 약 37ms 가 들고,
 * 그래서는 창을 부드럽게 따라갈 수 없다. macOS 는 상주 Swift 헬퍼(MacOSWindowSource)를 쓴다.
 *
 * `get-windows` 는 설치돼 있지 않을 수 있다. macOS 전용으로 쓰는 동안 불필요한 데다,
 * optionalDependencies 로 수정 패치 없는 취약점을 끌고 오기 때문이다 (PRD Q6).
 * 이 소스를 실제로 쓰려면 `npm i get-windows` 가 필요하다.
 *
 * events: `sample` | `error` — MacOSWindowSource 와 동일한 계약.
 */
export class PollingWindowSource extends EventEmitter {
  #timer = null;
  #running = false;
  #activeWindow = null;

  async start() {
    if (this.#running) return;
    this.#running = true;

    try {
      ({ activeWindow: this.#activeWindow } = await import('get-windows'));
    } catch (error) {
      this.#running = false;
      this.emit('error', new Error(
        `이 플랫폼(${process.platform})의 창 추적에는 get-windows 가 필요하다. `
        + `'npm i get-windows' 로 설치해야 한다. (원인: ${error.message})`,
      ));
      return;
    }
    this.#tick();
  }

  stop() {
    this.#running = false;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  async #tick() {
    if (!this.#running) return;
    try {
      const window = await this.#activeWindow(TRACKER_PERMISSIONS);
      this.emit('sample', window ? {
        pid: window.owner?.processId ?? null,
        bundleId: window.owner?.bundleId ?? null,
        appName: window.owner?.name ?? 'unknown',
        // Windows 의 bounds 는 물리 픽셀이라 Electron 의 DIP 좌표계로 변환해야 한다.
        bounds: process.platform === 'win32'
          ? screen.screenToDipRect(null, window.bounds)
          : window.bounds,
      } : null);
    } catch (error) {
      this.emit('error', error);
    }
    if (this.#running) {
      this.#timer = setTimeout(() => this.#tick(), POLL_INTERVAL_MS);
    }
  }
}
