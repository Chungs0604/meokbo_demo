/**
 * Claude Code 훅 / statusLine 등록·해제.
 *
 *   npm run hooks:install            이 프로젝트에만 적용 (.claude/settings.json)
 *   npm run hooks:install -- --global  전역 적용 (~/.claude/settings.json)
 *   npm run hooks:uninstall          프로젝트 설정에서 제거
 *   npm run hooks:uninstall -- --global
 *   npm run hooks:status             현재 등록 상태 확인
 *
 * 기본값을 프로젝트 전용으로 둔 이유: 전역 설정은 모든 프로젝트의 Claude Code 에 영향을 준다.
 * 개발 중에는 이 저장소에서만 테스트하면 되므로 전역을 건드릴 이유가 없다.
 * 실제로 상시 사용하려면 그때 --global 로 올린다 (한도는 계정 단위라 전역이 맞다).
 */
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOOK_BIN = path.join(root, 'native', 'macos', 'bin', 'hook-client');

/** 등록할 훅. PreToolUse/PostToolUse 는 매 툴 호출마다 돌므로 쓰지 않는다. */
const HOOK_EVENTS = [
  { event: 'Stop', matcher: null },                  // 작업 완료 → 빼꼼 (FR-30)
  { event: 'StopFailure', matcher: 'rate_limit' },   // 한도 소진 → 기절 (FR-22)
  { event: 'UserPromptSubmit', matcher: null },      // Idle 타이머 리셋 (FR-21)
  { event: 'SessionStart', matcher: null },          // 세션↔터미널 매핑
  { event: 'SessionEnd', matcher: null },
];

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith('--')) ?? 'status';
const isGlobal = args.includes('--global');

const settingsPath = isGlobal
  ? path.join(os.homedir(), '.claude', 'settings.json')
  : path.join(root, '.claude', 'settings.json');
const scopeLabel = isGlobal ? '전역' : '프로젝트';

function readSettings() {
  if (!fs.existsSync(settingsPath)) return {};
  const raw = fs.readFileSync(settingsPath, 'utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    // 설정이 깨진 상태에서 덮어쓰면 사용자 설정을 날린다. 멈추는 게 맞다.
    throw new Error(`${settingsPath} 가 올바른 JSON 이 아니다: ${error.message}`);
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  if (fs.existsSync(settingsPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${settingsPath}.bak-${stamp}`;
    fs.copyFileSync(settingsPath, backup);
    console.log(`  백업: ${backup}`);
  }
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

const isOurs = (command) => typeof command === 'string' && command.includes('claude-cs');

/** 우리 항목만 걷어낸다. 사용자가 직접 넣은 훅은 건드리지 않는다. */
function stripOurs(settings) {
  const hooks = settings.hooks ?? {};
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = groups
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h.command)) }))
      .filter((g) => g.hooks.length > 0);
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length) settings.hooks = hooks;
  else delete settings.hooks;

  if (isOurs(settings.statusLine?.command)) delete settings.statusLine;
  return settings;
}

function install() {
  if (!fs.existsSync(HOOK_BIN)) {
    throw new Error(`훅 바이너리가 없다. 'npm run build:native' 를 먼저 실행해야 한다 (${HOOK_BIN})`);
  }

  // 멱등하게: 기존 우리 항목을 먼저 지우고 새로 넣는다.
  const settings = stripOurs(readSettings());
  settings.hooks ??= {};

  for (const { event, matcher } of HOOK_EVENTS) {
    const entry = { hooks: [{ type: 'command', command: `"${HOOK_BIN}" ${event}`, timeout: 2 }] };
    if (matcher) entry.matcher = matcher;
    settings.hooks[event] = [...(settings.hooks[event] ?? []), entry];
  }

  settings.statusLine = { type: 'command', command: `"${HOOK_BIN}" statusline` };

  writeSettings(settings);
  console.log(`  ${scopeLabel} 설정에 등록했다: ${settingsPath}`);
  console.log(`  훅 ${HOOK_EVENTS.length}개 + statusLine`);
  console.log('  반영하려면 Claude Code 세션을 재시작해야 한다.');
}

function uninstall() {
  if (!fs.existsSync(settingsPath)) {
    console.log(`  ${settingsPath} 가 없다. 할 일이 없다.`);
    return;
  }
  writeSettings(stripOurs(readSettings()));
  console.log(`  ${scopeLabel} 설정에서 제거했다: ${settingsPath}`);
}

function status() {
  for (const [label, file] of [
    ['프로젝트', path.join(root, '.claude', 'settings.json')],
    ['전역', path.join(os.homedir(), '.claude', 'settings.json')],
  ]) {
    if (!fs.existsSync(file)) {
      console.log(`  ${label.padEnd(5)} 설정 없음`);
      continue;
    }
    const settings = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    const events = Object.entries(settings.hooks ?? {})
      .filter(([, groups]) => groups.some((g) => (g.hooks ?? []).some((h) => isOurs(h.command))))
      .map(([event]) => event);
    const sl = isOurs(settings.statusLine?.command);
    console.log(`  ${label.padEnd(5)} 훅 [${events.join(', ') || '없음'}]  statusLine ${sl ? '등록됨' : '없음'}`);
  }
}

const actions = { install, uninstall, status };
if (!actions[command]) {
  console.error(`알 수 없는 명령: ${command} (install | uninstall | status)`);
  process.exit(1);
}
actions[command]();
