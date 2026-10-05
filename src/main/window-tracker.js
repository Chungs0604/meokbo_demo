import { EventEmitter } from 'node:events';
import { TERMINAL_APP_NAMES, TERMINAL_BUNDLE_IDS } from './config.js';

function sameRect(a, b) {
  return Boolean(a) && Boolean(b)
    && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * 창 소스에서 받은 샘플을 "추적 대상 터미널 창"의 변화로 번역한다.
 *
 * 폴링은 소스가 담당한다. 여기서는 터미널 판정과 상태 전이만 본다.
 *
 * events
 *  - `target`      : { pid, bundleId, appName, bounds }  대상이 생겼거나 bounds 가 바뀜
 *  - `target-lost` : reason('no-window' | 'not-terminal')
 *  - `error`       : Error
 */
export class WindowTracker extends EventEmitter {
  #source;
  #lastTarget = null;
  #lastLostReason = null;
  #bundleIds;
  #appNames;

  constructor(source, { extraTerminalBundleIds = [], extraTerminalAppNames = [] } = {}) {
    super();
    this.#bundleIds = new Set([...TERMINAL_BUNDLE_IDS, ...extraTerminalBundleIds]);
    this.#appNames = [...TERMINAL_APP_NAMES, ...extraTerminalAppNames].map((n) => n.toLowerCase());

    this.#source = source;
    this.#source.on('sample', (sample) => this.#handleSample(sample));
    this.#source.on('error', (error) => this.emit('error', error));
  }

  /** 마지막으로 확인된 터미널 창. 대상을 잃어도 보존한다 (FR-04). */
  get lastTarget() {
    return this.#lastTarget;
  }

  start() {
    this.#source.start();
  }

  stop() {
    this.#source.stop();
  }

  isTerminal(sample) {
    const bundleId = sample.bundleId;
    if (bundleId && this.#bundleIds.has(bundleId)) return true;
    // macOS 에서 bundleId 를 얻었다면 그것이 정본이다. 이름 기반 판정은 다른 OS 용 폴백.
    if (bundleId) return false;

    const appName = (sample.appName ?? '').toLowerCase();
    return this.#appNames.some((name) => appName === name || appName.includes(name));
  }

  #handleSample(sample) {
    if (!sample) {
      this.#emitLost('no-window');
      return;
    }
    if (!this.isTerminal(sample)) {
      this.#emitLost('not-terminal');
      return;
    }

    const target = {
      pid: sample.pid,
      bundleId: sample.bundleId,
      appName: sample.appName,
      bounds: sample.bounds,
    };

    const unchanged = this.#lastLostReason === null
      && this.#lastTarget?.pid === target.pid
      && sameRect(this.#lastTarget?.bounds, target.bounds);

    this.#lastTarget = target;
    this.#lastLostReason = null;

    if (!unchanged) {
      this.emit('target', target);
    }
  }

  #emitLost(reason) {
    if (this.#lastLostReason === reason) return;
    this.#lastLostReason = reason;
    this.emit('target-lost', reason);
  }
}
