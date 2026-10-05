import { EventEmitter } from 'node:events';
import { IDLE_AFTER_MS, LIMIT_MODES } from './config.js';

/** 사용률 급락을 리셋으로 간주하는 기준(퍼센트포인트). */
const RESET_DROP_THRESHOLD = 20;

/**
 * Claude Code 훅 이벤트에서 사용량·활동 상태를 뽑아낸다.
 *
 * 수치(`rate_limits`)는 statusLine payload 에만 들어온다. 훅 payload 에는 없다.
 * 반대로 "작업이 끝난 정확한 순간"은 훅만 알려준다. 그래서 둘 다 받는다 (PRD §7.5).
 *
 * events
 *  - `usage`    : 아래 snapshot
 *  - `reset`    : { mode }            한도 창이 초기화됨 (FR-13, 트림 연출용)
 *  - `complete` : { sessionId }       작업 완료 (FR-30, 빼꼼용)
 *  - `exhausted`: { resetsAt }        한도 소진 (FR-22, 기절용)
 *  - `activity` : 사용자 입력·작업 발생 (Idle 타이머 리셋용)
 */
export class UsageMonitor extends EventEmitter {
  #limitMode;
  /** { five_hour: {usedPercentage, resetsAt}, seven_day: {...} } */
  #windows = { five_hour: null, seven_day: null };
  #lastActivityAt = Date.now();
  #idleTimer = null;
  #isIdle = false;
  /** 토큰 소모 속도 산출용 (FR-20). */
  #lastTokenSample = null;
  #tokensPerMinute = 0;

  constructor(limitMode = '5h') {
    super();
    this.#limitMode = LIMIT_MODES.includes(limitMode) ? limitMode : '5h';
  }

  get limitMode() {
    return this.#limitMode;
  }

  setLimitMode(mode) {
    if (!LIMIT_MODES.includes(mode) || mode === this.#limitMode) return;
    this.#limitMode = mode;
    this.#emitUsage();   // 모드가 바뀌면 사용률이 달라지므로 즉시 다시 알린다
  }

  start() {
    this.#idleTimer = setInterval(() => this.#checkIdle(), 10_000);
  }

  stop() {
    if (this.#idleTimer) clearInterval(this.#idleTimer);
    this.#idleTimer = null;
  }

  /** IpcServer 의 `hook` 이벤트를 그대로 넘기면 된다. */
  handleHook({ event, payload }) {
    switch (event) {
      case 'statusline':
        this.#ingestRateLimits(payload);
        this.#ingestTokens(payload);
        break;
      case 'UserPromptSubmit':
        this.#markActivity();
        break;
      case 'Stop':
        this.#markActivity();
        this.emit('complete', { sessionId: payload.session_id ?? null });
        break;
      case 'StopFailure':
        this.emit('exhausted', { resetsAt: this.nextResetAt() });
        break;
      case 'SessionStart':
        this.#markActivity();
        break;
      default:
        break;
    }
  }

  #ingestRateLimits(payload) {
    const limits = payload.rate_limits;
    // 구독자가 아니거나 첫 API 응답 전이면 아예 없다. 정상 경로다 (PRD §7.3).
    if (!limits) return;

    let changed = false;
    for (const key of ['five_hour', 'seven_day']) {
      const incoming = limits[key];
      if (!incoming || typeof incoming.used_percentage !== 'number') continue;

      const next = {
        usedPercentage: Math.max(0, Math.min(100, incoming.used_percentage)),
        resetsAt: typeof incoming.resets_at === 'number' ? incoming.resets_at * 1000 : null,
      };
      const prev = this.#windows[key];

      // 리셋 판정: 리셋 시각이 미래로 밀렸거나 사용률이 급락했다 (FR-13).
      if (prev) {
        const windowRolled = next.resetsAt && prev.resetsAt && next.resetsAt > prev.resetsAt;
        const dropped = prev.usedPercentage - next.usedPercentage >= RESET_DROP_THRESHOLD;
        if (windowRolled || dropped) {
          this.emit('reset', { mode: key === 'five_hour' ? '5h' : 'weekly' });
        }
      }

      this.#windows[key] = next;
      changed = true;
    }

    if (changed) this.#emitUsage();
  }

  /** context_window 변화량으로 토큰 소모 속도를 낸다 (FR-20: 밥 먹는 속도). */
  #ingestTokens(payload) {
    const window = payload.context_window;
    if (!window) return;
    const total = (window.total_input_tokens ?? 0) + (window.total_output_tokens ?? 0);
    const now = Date.now();

    if (this.#lastTokenSample) {
      const deltaTokens = total - this.#lastTokenSample.total;
      const deltaMinutes = (now - this.#lastTokenSample.at) / 60_000;
      // 컨텍스트가 압축되면 총량이 줄어든다. 음수는 속도로 치지 않는다.
      if (deltaTokens > 0 && deltaMinutes > 0) {
        this.#tokensPerMinute = Math.round(deltaTokens / deltaMinutes);
        this.#markActivity();
      }
    }
    this.#lastTokenSample = { total, at: now };
  }

  #markActivity() {
    this.#lastActivityAt = Date.now();
    if (this.#isIdle) {
      this.#isIdle = false;
      this.#emitUsage();
    }
    this.emit('activity');
  }

  #checkIdle() {
    if (this.#isIdle) return;
    if (Date.now() - this.#lastActivityAt < IDLE_AFTER_MS) return;
    this.#isIdle = true;
    this.#emitUsage();
  }

  /** 선택된 한도 기준 사용률. 데이터가 없으면 null 이다. */
  usedPercentage() {
    const key = this.#limitMode === 'weekly' ? 'seven_day' : 'five_hour';
    return this.#windows[key]?.usedPercentage ?? null;
  }

  /** 두 한도 창 중 더 빨리 풀리는 쪽의 리셋 시각 (PRD §2.2). */
  nextResetAt() {
    const times = [this.#windows.five_hour?.resetsAt, this.#windows.seven_day?.resetsAt]
      .filter((t) => typeof t === 'number');
    return times.length ? Math.min(...times) : null;
  }

  snapshot() {
    return {
      limitMode: this.#limitMode,
      usedPercentage: this.usedPercentage(),
      nextResetAt: this.nextResetAt(),
      tokensPerMinute: this.#tokensPerMinute,
      isIdle: this.#isIdle,
      hasData: this.#windows.five_hour !== null || this.#windows.seven_day !== null,
      windows: { ...this.#windows },
    };
  }

  #emitUsage() {
    this.emit('usage', this.snapshot());
  }
}
