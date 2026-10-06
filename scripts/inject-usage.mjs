/**
 * 디버그용 사용률 주입.
 *
 *   npm run inject -- 75                # 사용률 75%
 *   npm run inject -- 100 --reset-in 8  # 100%, 리셋까지 8분
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
const statusLine = execFileSync(binary, ['statusline'], {
  input: JSON.stringify(payload),
  encoding: 'utf8',
});

console.log(`주입: ${percent}% / 리셋 ${new Date(resetsAt * 1000).toLocaleTimeString()}`);
console.log(`statusLine 출력: ${statusLine.trim() || '(없음)'}`);
