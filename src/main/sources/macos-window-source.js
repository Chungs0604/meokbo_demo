import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const WATCHER_BIN = path.join(here, '..', '..', '..', 'native', 'macos', 'bin', 'window-watcher');

const RESTART_DELAY_MS = 1000;
const MAX_RESTARTS = 5;

/**
 * 상주 Swift 헬퍼에서 창 변화를 받아 전달한다.
 *
 * get-windows 는 호출마다 프로세스를 띄워 1회 36.8ms 가 들었다. 헬퍼는 프로세스를 한 번만 띄우고
 * 내부에서 CGWindowList 를 0.4ms 로 읽어, 변화가 있을 때만 NDJSON 한 줄을 보낸다.
 *
 * events
 *  - `sample` : { pid, bundleId, appName, bounds } | null   (null = 추적할 창 없음)
 *  - `error`  : Error
 */
export class MacOSWindowSource extends EventEmitter {
  #child = null;
  #rl = null;
  #running = false;
  #restarts = 0;
  #restartTimer = null;

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#spawn();
  }

  stop() {
    this.#running = false;
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }
    this.#rl?.close();
    this.#rl = null;
    this.#child?.kill();
    this.#child = null;
  }

  #spawn() {
    if (!this.#running) return;

    // 오버레이는 screen-saver 레벨이라 layer 0 필터에서 이미 빠지지만, 명시적으로도 제외한다.
    this.#child = spawn(WATCHER_BIN, ['--exclude-pid', String(process.pid)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.#child.on('error', (error) => {
      const hint = error.code === 'ENOENT'
        ? ` 네이티브 헬퍼가 없다. 'npm run build:native' 를 실행해야 한다 (${WATCHER_BIN})`
        : '';
      this.emit('error', new Error(`window-watcher 실행 실패: ${error.message}.${hint}`));
    });

    this.#child.stderr.on('data', (chunk) => {
      this.emit('error', new Error(`window-watcher stderr: ${String(chunk).trim()}`));
    });

    this.#rl = readline.createInterface({ input: this.#child.stdout });
    this.#rl.on('line', (line) => this.#handleLine(line));

    this.#child.on('exit', (code, signal) => {
      if (!this.#running) return;
      this.emit('error', new Error(`window-watcher 가 종료됐다 (code=${code} signal=${signal})`));
      this.#scheduleRestart();
    });
  }

  #scheduleRestart() {
    if (this.#restarts >= MAX_RESTARTS) {
      this.emit('error', new Error(
        `window-watcher 재시작을 ${MAX_RESTARTS}회 시도했으나 실패했다. 창 추적을 중단한다.`,
      ));
      this.#running = false;
      return;
    }
    this.#restarts += 1;
    this.#restartTimer = setTimeout(() => this.#spawn(), RESTART_DELAY_MS);
  }

  #handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;

    let payload;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      this.emit('error', new Error(`window-watcher 출력을 파싱하지 못했다: ${trimmed.slice(0, 120)}`));
      return;
    }

    // 한 줄이라도 정상 수신하면 헬퍼가 살아난 것으로 본다.
    this.#restarts = 0;

    if (payload.type === 'none') {
      this.emit('sample', null);
      return;
    }
    this.emit('sample', {
      pid: payload.pid,
      bundleId: payload.bundleId || null,
      appName: payload.appName || 'unknown',
      bounds: payload.bounds,
    });
  }
}
