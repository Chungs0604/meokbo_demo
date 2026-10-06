import { FATNESS_STAGES } from './config.js';

/**
 * 사용률(0~100)을 체형으로 바꾼다 (FR-11).
 *
 * `fatness` 는 0~1 연속값이고 `stage` 는 연출 분기용 라벨이다. 실제 체형 보간은
 * 렌더러가 `--fatness` CSS 변수로 한다 (FR-12).
 *
 * 계산이 main 에 있는 이유: 렌더러는 sandbox + CSP `'self'` 라 ESM import 가 없어
 * 이 모듈을 공유할 수 없다. main 에 두면 Electron 없이 단위 테스트할 수 있고
 * PRD §4 도표의 "렌더러 = 체형 보간" 분담과도 맞는다.
 *
 * 사용률을 모르면 `null` 을 준다. 0% 로 꾸며내면 "아직 데이터가 없다" 와
 * "한도를 안 썼다" 가 구분되지 않는다.
 */
export function computeFatness(usedPercentage) {
  if (typeof usedPercentage !== 'number' || Number.isNaN(usedPercentage)) return null;

  const percent = Math.max(0, Math.min(100, usedPercentage));
  return {
    fatness: percent / 100,
    stage: FATNESS_STAGES.find((candidate) => percent < candidate.below).stage,
  };
}
