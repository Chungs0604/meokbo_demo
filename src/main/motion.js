import { TOKENS_PER_MINUTE_FULL } from './config.js';

/**
 * 토큰 소모 속도를 밥 먹는 세기 0~1 로 바꾼다 (FR-20).
 *
 * 체형(`fatness`)과 같은 이유로 main 에서 계산한다 — 렌더러는 sandbox + CSP `'self'`
 * 라 이 모듈을 import 할 수 없고, 여기 있으면 Electron 없이 테스트할 수 있다.
 * 렌더러는 이 값을 애니메이션 속도로만 환산한다.
 */
export function computeIntake(tokensPerMinute) {
  if (typeof tokensPerMinute !== 'number' || !Number.isFinite(tokensPerMinute)) return 0;
  return Math.max(0, Math.min(1, tokensPerMinute / TOKENS_PER_MINUTE_FULL));
}
