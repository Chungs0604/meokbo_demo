import { EventEmitter } from 'node:events';
import { EXHAUSTED_PERCENTAGE } from './config.js';

/**
 * 캐릭터 행동 상태 (PRD §2.3).
 *
 * `PEEK` 는 Phase 4(빼꼼 알림) 범위라 **전이를 구현하지 않았다.** 상수만 정의해 둔 이유는
 * 전이표에서 이 상태가 끼어들 자리를 명시해 두기 위해서다 (EXHAUSTED 와 IDLE 사이).
 */
export const CHARACTER_STATES = Object.freeze({
  HIDDEN: 'HIDDEN',
  EXHAUSTED: 'EXHAUSTED',
  BURP: 'BURP',
  PEEK: 'PEEK',
  IDLE: 'IDLE',
  WORKING: 'WORKING',
});

/**
 * 창 추적 상태와 사용량을 받아 캐릭터가 지금 무엇을 하고 있어야 하는지 정한다.
 *
 * 타이머를 직접 돌리지 않는다. 입력이 바뀔 때만 다시 판정하는 리듀서라
 * Electron 없이 단위 테스트할 수 있다 (3분 Idle 판정은 UsageMonitor 가 하고
 * 여기는 그 결과인 `isIdle` 만 본다).
 *
 * events
 *  - `change` : { state, previous, reason }
 */
export class StateMachine extends EventEmitter {
  #state = CHARACTER_STATES.HIDDEN;
  #visible = false;
  #usage = null;
  /**
   * StopFailure 훅으로 들어온 소진. 사용률로는 판정할 수 없다 —
   * 훅이 올 때 사용률이 아직 100% 로 올라오지 않은 경우가 있기 때문이다.
   * 한도가 실제로 풀려야(=`reset` 이벤트) 내린다.
   */
  #exhaustedByHook = false;
  /**
   * 한도 리셋 트림 연출 중인지 (FR-13).
   *
   * 이것만 **밖에서 끝을 알려줘야 한다.** 다른 상태는 입력이 바뀌면 자연히 풀리는데
   * 트림은 "정해진 시간이 지나면" 끝나기 때문이다. 리듀서를 타이머 없이 두려고
   * (Electron 없이 테스트된다) 타이머는 호출자가 든다.
   */
  #burping = false;

  get state() {
    return this.#state;
  }

  /** 추적 대상 터미널이 활성인지. WindowTracker 의 target / target-lost 에 대응한다. */
  setVisible(visible) {
    this.#visible = Boolean(visible);
    this.#evaluate();
  }

  /** UsageMonitor 의 usage 스냅샷. */
  setUsage(snapshot) {
    this.#usage = snapshot;
    this.#evaluate();
  }

  /** StopFailure 훅 (matcher: rate_limit). */
  markExhausted() {
    this.#exhaustedByHook = true;
    this.#evaluate();
  }

  /** 한도 창 초기화 (FR-13). */
  clearExhausted() {
    this.#exhaustedByHook = false;
    this.#evaluate();
  }

  /** 트림 연출 시작 (FR-13). 끝은 호출자가 `endBurp()` 로 알려준다. */
  startBurp() {
    this.#burping = true;
    this.#evaluate();
  }

  /** 트림 연출 종료 (FR-13). */
  endBurp() {
    this.#burping = false;
    this.#evaluate();
  }

  /**
   * 전이표. 위에서부터 먼저 맞는 규칙이 이긴다.
   *
   * | 순위 | 조건                        | 상태        | 근거   |
   * | ---- | --------------------------- | ----------- | ------ |
   * | 1    | 추적 대상 없음              | `HIDDEN`    | FR-04  |
   * | 2    | StopFailure 훅              | `EXHAUSTED` | FR-22  |
   * | 3    | 한도 리셋 직후              | `BURP`      | FR-13  |
   * | 4    | 사용률 100%                 | `EXHAUSTED` | FR-22  |
   * | 5    | (Phase 4: 비활성 + 작업 완료) | `PEEK`      | FR-23  |
   * | 6    | 3분 무활동                  | `IDLE`      | FR-21  |
   * | 7    | 그 외                       | `WORKING`   | FR-20  |
   *
   * 기절이 두 줄로 갈라진 것은 의도다. 훅으로 들어온 "지금 못 쓴다"는 트림보다 세지만,
   * 사용률은 리셋 시점에 아직 옛 값이라 트림보다 약해야 한다.
   *
   * `WORKING` 이 마지막인 것은 의도다. PRD 가 `WORKING` 을 "작업 중" 이라고만 적어
   * Stop 훅 직후부터 3분까지가 비어 있어서, FR-21 의 여집합을 `WORKING` 으로 본다.
   * 토큰을 안 쓰면 밥 먹는 속도가 0 이라 연출상 어색하지 않다.
   */
  #evaluate() {
    const next = this.#decide();
    if (next.state === this.#state) return;

    const previous = this.#state;
    this.#state = next.state;
    this.emit('change', { state: next.state, previous, reason: next.reason });
  }

  #decide() {
    const { HIDDEN, EXHAUSTED, BURP, IDLE, WORKING } = CHARACTER_STATES;

    if (!this.#visible) return { state: HIDDEN, reason: 'no-target' };

    if (this.#exhaustedByHook) return { state: EXHAUSTED, reason: 'stop-failure' };

    /*
     * 트림이 사용률보다 먼저다. 리셋을 알리는 샘플이 들어온 시점에 손에 들고 있는
     * 사용률은 아직 리셋 전 값(100%)이라, 사용률을 먼저 보면 트림이 영영 안 나온다.
     * 창이 넘어갔다는 사실이 그 수치보다 새 정보다.
     */
    if (this.#burping) return { state: BURP, reason: 'limit-reset' };

    if (this.#usage?.usedPercentage >= EXHAUSTED_PERCENTAGE) {
      return { state: EXHAUSTED, reason: 'limit-reached' };
    }

    if (this.#usage?.isIdle) return { state: IDLE, reason: 'no-activity' };

    return { state: WORKING, reason: 'active' };
  }
}
