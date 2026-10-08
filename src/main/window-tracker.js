import process from 'node:process';
import { EventEmitter } from 'node:events';
import {
  TERMINAL_APP_NAMES,
  TERMINAL_BUNDLE_IDS,
  SPACE_SLIDE_JUMP_PX,
  SPACE_SLIDE_SETTLE_MS,
} from './config.js';

function sameRect(a, b) {
  return Boolean(a) && Boolean(b)
    && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Space 전환 애니메이션 감지를 macOS 에서만 켠다.
 *
 * 두 가지 이유다. (1) 창을 실제로 미끄러뜨리는 Space 전환 자체가 macOS 현상이다.
 * (2) 비 macOS 폴백(PollingWindowSource)은 변화 여부와 무관하게 250ms 마다 샘플을 쏘므로
 * "한 샘플에 N px" 로는 드래그와 애니메이션을 갈라낼 수 없다 — 초당 240px 로 끄는
 * 평범한 드래그가 전부 애니메이션으로 오판된다.
 */
const DETECT_SPACE_SLIDE = process.platform === 'darwin';

/**
 * Space 전환으로 볼 수 있는 "순수 수평 이동" 거리. 아니면 0.
 *
 * 세 가지가 모두 그대로여야 한다 — 같은 창(pid), 같은 크기, 같은 y.
 * macOS 의 Space 는 항상 가로로 늘어서므로 전환 애니메이션은 x 만 움직인다
 * (실측: 전 구간 y=210 / 1297x659 가 한 글자도 안 바뀌었다). 반면 사람이 끄는 드래그가
 * 한 샘플 동안 y 를 **정확히** 유지하는 일은 사실상 없다. 그래서 이 조건이 거리보다
 * 강한 판별이고, 덕분에 임계값을 ease-in 첫 프레임(80px) 아래로 낮출 수 있다.
 * 리사이즈와 다른 창으로의 교체도 여기서 함께 걸러진다.
 */
function slideDistance(prev, next) {
  if (!prev || prev.pid !== next.pid) return 0;
  const a = prev.bounds;
  const b = next.bounds;
  if (a.y !== b.y || a.width !== b.width || a.height !== b.height) return 0;
  return Math.abs(b.x - a.x);
}

/**
 * 창 소스에서 받은 샘플을 "추적 대상 터미널 창"의 변화로 번역한다.
 *
 * 폴링은 소스가 담당한다. 여기서는 터미널 판정과 상태 전이만 본다.
 *
 * events
 *  - `target`      : { pid, bundleId, appName, bounds }  대상이 생겼거나 bounds 가 바뀜
 *  - `target-lost` : reason('no-window' | 'not-terminal' | 'space-slide')
 *  - `error`       : Error
 */
export class WindowTracker extends EventEmitter {
  #source;
  #lastTarget = null;
  #lastLostReason = null;
  #bundleIds;
  #appNames;
  /** Space 전환 애니메이션이 진행 중인지 (#holdDuringSlide). */
  #sliding = false;
  #settleTimer = null;

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
    this.#cancelSlide();
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
      this.#cancelSlide();
      this.#emitLost('no-window');
      return;
    }
    if (!this.isTerminal(sample)) {
      this.#cancelSlide();
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

    const sliding = DETECT_SPACE_SLIDE
      && (this.#sliding || slideDistance(this.#lastTarget, target) >= SPACE_SLIDE_JUMP_PX);

    // 마지막으로 확인된 창은 전환 중에도 갱신한다. 정착했을 때 쓸 값이다 (FR-04).
    this.#lastTarget = target;

    if (sliding) {
      this.#holdDuringSlide();
      return;
    }

    this.#lastLostReason = null;

    if (!unchanged) {
      this.emit('target', target);
    }
  }

  /**
   * Space 전환 애니메이션 중에는 숨겨 두고, 샘플이 조용해질 때까지 `target` 을 미룬다.
   *
   * macOS 는 Space 를 전환할 때 창을 실제로 미끄러뜨리고 `CGWindowList` 가 그 중간 좌표를
   * 그대로 돌려준다. 따라가면 오버레이가 드문 샘플마다 순간이동해 깜빡이고, 화면 끝에
   * 클램프됐다 튀면서 잔상처럼 보인다 (Control+방향키 실측).
   *
   * 전환 **시작**을 알려주는 공개 API 는 없다. 하지만 알아낼 필요가 없다 —
   * 애니메이션 프레임 자체가 신호다. 크기와 y 가 그대로인데 x 만 수십~수백 px 뛰는 창은
   * 사람이 끈 것이 아니다.
   *
   * 한 번 전환으로 판정하면 조용해질 때까지 유지한다. ease-out 끝자락의 보정 샘플은
   * 이동량이 작아서(실측 34px·2px) 임계값만으로는 걸러지지 않기 때문이다.
   */
  #holdDuringSlide() {
    this.#sliding = true;
    this.#emitLost('space-slide');
    clearTimeout(this.#settleTimer);
    this.#settleTimer = setTimeout(() => this.#settle(), SPACE_SLIDE_SETTLE_MS);
  }

  /** 전환이 끝났다. 마지막으로 받은 자리에 캐릭터를 되돌린다. */
  #settle() {
    this.#settleTimer = null;
    this.#sliding = false;
    if (!this.#lastTarget) return;
    this.#lastLostReason = null;
    this.emit('target', this.#lastTarget);
  }

  /** 전환 중에 대상을 잃으면(앱 전환·창 없음) 미뤄 둔 복귀를 취소한다. */
  #cancelSlide() {
    clearTimeout(this.#settleTimer);
    this.#settleTimer = null;
    this.#sliding = false;
  }

  #emitLost(reason) {
    if (this.#lastLostReason === reason) return;
    this.#lastLostReason = reason;
    this.emit('target-lost', reason);
  }
}
