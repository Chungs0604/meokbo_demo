/**
 * 디버그용 사용률 주입.
 *
 *   npm run inject -- 75                 # 사용률 75%
 *   npm run inject -- 100 --reset-in 8   # 100%, 리셋까지 8분
 *   npm run inject -- 30 --tokens 18000  # 분당 18000 토큰을 쓰는 중인 것처럼
 *
 * 프로덕션 코드에 주입용 백도어를 만들지 않기 위해, 진짜 statusLine 과 **같은 경로**로
 * 보낸다. hook-client 에 stdin 으로 payload 를 물려주면 그 뒤는 실제 호출과 구별되지 않는다.
 *
 * 주의: 활성 Claude Code 세션이 있으면 진짜 statusLine 이 곧 이 값을 덮어쓴다.
 * 4단계를 눈으로 확인할 때는 다른 터미널에서 Claude Code 를 쓰지 않거나 주입을 반복한다.
 *
 * 두 한도 창에 같은 값을 넣는다. 앱의 limitMode 가 5h 든 weekly 든 반영되게 하려는 것이다.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(root, 'native', 'macos', 'bin', 'hook-client');

const args = process.argv.slice(2);
const percent = Number(args[0]);
if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
  console.error('사용법: npm run inject -- <0~100> [--reset-in <분>]');
  process.exit(1);
}

const tokensIndex = args.indexOf('--tokens');
const tokens = tokensIndex >= 0 ? Number(args[tokensIndex + 1]) : null;
if (tokensIndex >= 0 && (!Number.isFinite(tokens) || tokens < 0)) {
  console.error('--tokens 에는 0 이상의 숫자를 준다.');
  process.exit(1);
}

const resetInIndex = args.indexOf('--reset-in');
const resetInMinutes = resetInIndex >= 0 ? Number(args[resetInIndex + 1]) : 60;
if (!Number.isFinite(resetInMinutes)) {
  console.error('--reset-in 에는 분 단위 숫자를 준다.');
  process.exit(1);
}

/*
 * 초 단위 epoch 이다 (UsageMonitor 가 1000 을 곱한다).
 * 분 경계로 맞추는 이유: 같은 분 안에 여러 번 주입하면 값이 똑같아야 한다.
 * 매번 초가 밀리면 UsageMonitor 가 "리셋 시각 전진" 으로 보고 리셋을 오탐한다 (FR-13).
 * 실제 Claude Code 가 주는 resets_at 도 분 경계다 (실측: 1791224400 = 03:20:00).
 */
const resetsAt = Math.round((Date.now() + resetInMinutes * 60_000) / 60_000) * 60;
const window = { used_percentage: percent, resets_at: resetsAt };
const payload = { rate_limits: { five_hour: window, seven_day: window } };

// hook-client 는 소켓이 닫혀 있어도 조용히 exit 0 한다. 앱이 꺼져 있으면 아무 일도 안 일어난다.
function send(body) {
  return execFileSync(binary, ['statusline'], { input: JSON.stringify(body), encoding: 'utf8' });
}

const statusLine = send(payload);

/*
 * 밥 먹는 속도(FR-20)를 재현한다.
 *
 * UsageMonitor 는 context_window 총량의 **증가분**만 센다. 진짜 세션이 이미 큰 총량을
 * 올려둔 상태라 원하는 증가분을 한 번에 만들 수 없다. 그래서 두 번 보낸다 —
 * 먼저 0 을 보내 기준점을 바닥으로 내리고(총량이 줄어든 것이므로 소모로 치지 않는다),
 * 이어서 tokens 를 보내 딱 그만큼의 증가분을 만든다.
 *
 * 주의: 기준점이 tokens 로 남으므로 다음 진짜 statusLine 의 증가분은 거기서부터 재진다.
 * 한 번은 과다 또는 과소로 잡힐 수 있다. 1분 창이 만료되면 사라지지만,
 * 속도를 볼 때는 Claude Code 를 쓰지 않는 쪽이 깔끔하다.
 */
if (tokens !== null) {
  const withTokens = (total) => ({
    ...payload,
    context_window: { total_input_tokens: total, total_output_tokens: 0 },
  });
  send(withTokens(0));
  send(withTokens(tokens));
}

console.log(`주입: ${percent}% / 리셋 ${new Date(resetsAt * 1000).toLocaleTimeString()}`);
if (tokens !== null) console.log(`       소모 속도 ${tokens} tokens/min`);
console.log(`statusLine 출력: ${statusLine.trim() || '(없음)'}`);
