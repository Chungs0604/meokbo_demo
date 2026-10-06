/**
 * UsageMonitor 단위 검증.  실행: npm run test:usage
 * Electron 없이 돌아간다 (usage-monitor.js 는 electron 을 import 하지 않는다).
 */
import { UsageMonitor } from '../src/main/usage-monitor.js';
import { computeFatness } from '../src/main/fatness.js';

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : `  기대=${JSON.stringify(expected)} 실제=${JSON.stringify(actual)}`}`);
  ok ? passed++ : failed++;
}

const SEC = 1;
const statusline = (fiveHour, sevenDay, context) => ({
  event: 'statusline',
  payload: {
    rate_limits: {
      ...(fiveHour ? { five_hour: { used_percentage: fiveHour[0], resets_at: fiveHour[1] } } : {}),
      ...(sevenDay ? { seven_day: { used_percentage: sevenDay[0], resets_at: sevenDay[1] } } : {}),
    },
    ...(context ? { context_window: context } : {}),
  },
});

console.log('--- 한도 모드별 사용률 (FR-10, FR-11) ---');
{
  const m = new UsageMonitor('5h');
  m.handleHook(statusline([42, 1000 * SEC], [13, 5000 * SEC]));
  check('5h 모드는 five_hour 를 본다', m.usedPercentage(), 42);
  m.setLimitMode('weekly');
  check('weekly 모드는 seven_day 를 본다', m.usedPercentage(), 13);
  m.setLimitMode('nonsense');
  check('잘못된 모드는 무시한다', m.limitMode, 'weekly');
}

console.log('--- 빠른 리셋 선택 (PRD §2.2) ---');
{
  const m = new UsageMonitor('weekly');
  m.handleHook(statusline([90, 1000], [50, 5000]));
  check('두 창 중 더 이른 쪽을 고른다', m.nextResetAt(), 1000 * 1000);
}

console.log('--- 리셋 감지 (FR-13) ---');
{
  const m = new UsageMonitor('5h');
  const seen = [];
  m.on('reset', (e) => seen.push(e.mode));
  m.handleHook(statusline([95, 1000], [40, 5000]));
  m.handleHook(statusline([95, 1000], [40, 5000]));
  check('변화 없으면 리셋 아님', seen, []);
  m.handleHook(statusline([3, 2000], [40, 5000]));     // 창이 미래로 밀림 + 급락
  check('리셋 시각 전진 → 리셋', seen, ['5h']);
  m.handleHook(statusline([3, 2000], [5, 5000]));      // 주간만 급락
  check('사용률 급락 → 리셋', seen, ['5h', 'weekly']);
}

console.log('--- rate_limits 부재 (PRD §7.3) ---');
{
  const m = new UsageMonitor('5h');
  let emitted = 0;
  m.on('usage', () => emitted++);
  m.handleHook({ event: 'statusline', payload: { session_id: 'x' } });
  check('없으면 사용률은 null', m.usedPercentage(), null);
  check('없으면 hasData=false', m.snapshot().hasData, false);
  check('없으면 usage 를 쏘지 않는다', emitted, 0);
}

console.log('--- 토큰 소모 속도 (FR-20) ---');
{
  const m = new UsageMonitor('5h');
  m.handleHook(statusline([10, 1000], null, { total_input_tokens: 1000, total_output_tokens: 0 }));
  check('첫 샘플은 속도를 못 낸다', m.snapshot().tokensPerMinute, 0);
  m.handleHook(statusline([10, 1000], null, { total_input_tokens: 500, total_output_tokens: 0 }));
  check('컨텍스트 압축(감소)은 속도로 안 친다', m.snapshot().tokensPerMinute, 0);
}

console.log('--- 완료 / 소진 이벤트 (FR-30, FR-22) ---');
{
  const m = new UsageMonitor('5h');
  const events = [];
  m.on('complete', (e) => events.push(['complete', e.sessionId]));
  m.on('exhausted', (e) => events.push(['exhausted', e.resetsAt]));
  m.handleHook(statusline([100, 7000], [80, 9000]));
  m.handleHook({ event: 'Stop', payload: { session_id: 's1' } });
  m.handleHook({ event: 'StopFailure', payload: {} });
  check('Stop → complete', events[0], ['complete', 's1']);
  check('StopFailure → exhausted(빠른 리셋 시각)', events[1], ['exhausted', 7000 * 1000]);
}

console.log('--- 사용률 범위 보정 ---');
{
  const m = new UsageMonitor('5h');
  m.handleHook(statusline([137, 1000], null));
  check('100 초과는 100 으로 자른다', m.usedPercentage(), 100);
  m.handleHook(statusline([-5, 1000], null));
  check('음수는 0 으로 자른다', m.usedPercentage(), 0);
}

console.log('--- 체형 단계 매핑 (FR-11) ---');
{
  const stage = (p) => computeFatness(p)?.stage;
  check('0% → 홀쭉', stage(0), 'slim');
  check('33.9% → 홀쭉 (경계 안쪽)', stage(33.9), 'slim');
  check('34% → 통통 (경계)', stage(34), 'chubby');
  check('66.9% → 통통 (경계 안쪽)', stage(66.9), 'chubby');
  check('67% → 뚱뚱 (경계)', stage(67), 'fat');
  check('99.9% → 뚱뚱 (경계 안쪽)', stage(99.9), 'fat');
  check('100% → 한계', stage(100), 'limit');
  // Phase 2 실측값. 부동소수 오차가 경계를 넘기지 않는지 본다.
  check('28.999999999999996% → 홀쭉', stage(28.999999999999996), 'slim');
}

console.log('--- 체형 연속값 (FR-12) ---');
{
  check('0% → 0', computeFatness(0).fatness, 0);
  check('50% → 0.5', computeFatness(50).fatness, 0.5);
  check('100% → 1', computeFatness(100).fatness, 1);
  check('100 초과는 1 로 자른다', computeFatness(137).fatness, 1);
  check('음수는 0 으로 자른다', computeFatness(-5).fatness, 0);
  // 0% 로 꾸며내면 "아직 모른다" 와 "안 썼다" 가 구분되지 않는다.
  check('수치 없으면 null', computeFatness(null), null);
  check('NaN 도 null', computeFatness(Number.NaN), null);
}

console.log('--- 스냅샷에 체형이 실린다 (PR A 배선) ---');
{
  const m = new UsageMonitor('5h');
  check('데이터 전에는 fatness=null', m.snapshot().fatness, null);
  check('데이터 전에는 stage=null', m.snapshot().stage, null);
  m.handleHook(statusline([70, 1000], [20, 5000]));
  check('5h 70% → fatness 0.7', m.snapshot().fatness, 0.7);
  check('5h 70% → stage fat', m.snapshot().stage, 'fat');
  m.setLimitMode('weekly');
  check('모드를 바꾸면 체형도 따라간다', m.snapshot().stage, 'slim');
}

console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed}건 실패`}  (통과 ${passed} / 전체 ${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
