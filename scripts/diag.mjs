/**
 * Phase 1 검증용 진단 스크립트.  실행: npm run diag
 *  - 디스플레이 좌표계 출력
 *  - 현재 Active Window 와 터미널 판정 결과
 *  - isTerminal 단위 체크
 *  - computeOverlayBounds 경계 케이스 체크
 *  - 실제 오버레이 윈도우를 띄우고 해당 영역을 캡처 (--capture)
 *  - 체형 4단계를 각각 렌더해 PNG 로 남김 (--capture --fatness)
 *  - 캐릭터 상태별로 렌더해 PNG 로 남김 (--capture --states)
 */
import process from 'node:process';
import path from 'node:path';
import { app, screen } from 'electron';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { WindowTracker } from '../src/main/window-tracker.js';
import { createWindowSource } from '../src/main/sources/index.js';
import { OverlayWindow, computeOverlayBounds } from '../src/main/overlay-window.js';
import { OVERLAY_SIZE } from '../src/main/config.js';
import { computeFatness } from '../src/main/fatness.js';
import { computeIntake } from '../src/main/motion.js';

const execFileAsync = promisify(execFile);
const CAPTURE_DIR = process.env.CLAUDE_CS_CAPTURE_DIR ?? app.getPath('temp');
const wantCapture = process.argv.includes('--capture');
const wantFatness = process.argv.includes('--fatness');
const wantStates = process.argv.includes('--states');

/**
 * 캐릭터 발바닥 라인 = 박스 상단 + (박스 높이 - 스프라이트 셀의 FOOT_MARGIN 4px).
 * build-sheet.mjs 가 발끝을 셀 바닥에서 4px 띄워 굽는다.
 */
const FOOT_FROM_BOX_TOP = OVERLAY_SIZE.height - 4;

app.dock?.hide();
app.whenReady().then(main).catch((error) => {
  console.error('DIAG ERROR', error);
  app.exit(1);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 창 소스에서 샘플 하나를 받아 바로 닫는다. */
function firstSample(timeoutMs = 3000) {
  return new Promise(async (resolve) => {
    const source = await createWindowSource();
    const done = (value) => {
      clearTimeout(timer);
      source.stop();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    source.once('sample', done);
    source.once('error', (error) => {
      console.error('  source error:', error.message);
      done(null);
    });
    source.start();
  });
}

async function main() {
  let ok = true;

  console.log('--- displays ---');
  for (const d of screen.getAllDisplays()) {
    console.log(`  id=${d.id} scale=${d.scaleFactor} bounds=${JSON.stringify(d.bounds)} workArea=${JSON.stringify(d.workArea)}`);
  }

  const tracker = new WindowTracker(await createWindowSource(), {});

  console.log('--- live window source ---');
  const live = await firstSample();
  if (live) {
    console.log(`  app=${live.appName} bundleId=${live.bundleId} pid=${live.pid}`);
    console.log(`  bounds=${JSON.stringify(live.bounds)}`);
    console.log(`  isTerminal=${tracker.isTerminal(live)}`);
  } else {
    console.log('  샘플을 받지 못했다 (헬퍼 미빌드이거나 추적할 창 없음)');
  }

  console.log('--- isTerminal ---');
  const cases = [
    [{ bundleId: 'com.googlecode.iterm2', appName: 'iTerm2' }, true],
    [{ bundleId: 'com.apple.Terminal', appName: 'Terminal' }, true],
    [{ bundleId: 'com.mitchellh.ghostty', appName: 'ghostty' }, true],
    [{ bundleId: 'com.apple.finder', appName: 'Finder' }, false],
    [{ bundleId: 'com.spotify.client', appName: 'Spotify' }, false],
    [{ bundleId: null, appName: 'WindowsTerminal.exe' }, true],
    [{ bundleId: null, appName: 'explorer.exe' }, false],
  ];
  for (const [sample, expected] of cases) {
    const got = tracker.isTerminal(sample);
    const pass = got === expected;
    ok = ok && pass;
    console.log(`  ${pass ? 'PASS' : 'FAIL'} ${sample.bundleId ?? sample.appName} => ${got}`);
  }

  console.log('--- computeOverlayBounds ---');
  const B = screen.getPrimaryDisplay().bounds;
  const samples = {
    'typical window':      { x: 178, y: 70, width: 1395, height: 917 },
    'far right edge':      { x: B.x + B.width - 400, y: 300, width: 400, height: 400 },
    'far left edge':       { x: B.x, y: 300, width: 300, height: 400 },
    'wider than screen':   { x: -50, y: 200, width: B.width + 100, height: 500 },
    // 창이 화면 최상단이면 위쪽에 공간이 없다. 화면 안으로 클램프되는 것만 보장한다.
    'at screen top (y=0)': { x: 100, y: 0, width: 800, height: 600, clampedOnly: true },
  };
  for (const [label, sample] of Object.entries(samples)) {
    const { clampedOnly = false, ...b } = sample;
    const o = computeOverlayBounds(b);
    const inside = o.x >= B.x && o.x + o.width <= B.x + B.width
                && o.y >= B.y && o.y + o.height <= B.y + B.height;
    const footOffset = (o.y + FOOT_FROM_BOX_TOP) - b.y;
    const sits = clampedOnly ? o.y === B.y : footOffset >= 0 && footOffset <= 20;
    const pass = inside && sits;
    ok = ok && pass;
    console.log(`  ${pass ? 'PASS' : 'FAIL'} ${label}`);
    console.log(`       win=${JSON.stringify(b)}`);
    console.log(`       overlay=${JSON.stringify(o)} insideScreen=${inside} footOffset=${footOffset}px${clampedOnly ? ' (clamped)' : ''}`);
  }

  if (wantCapture) {
    console.log('--- overlay render capture ---');
    const overlay = new OverlayWindow();
    await overlay.create();

    // 화면 중앙에 가상의 "터미널 창"이 있다고 가정하고 거기에 올려본다.
    const fakeTarget = {
      appName: 'DIAG',
      bundleId: 'diag',
      bounds: {
        x: Math.round(B.x + B.width / 2 - 400),
        y: Math.round(B.y + B.height / 2 - 200),
        width: 800,
        height: 400,
      },
    };
    overlay.syncToTarget(fakeTarget);
    await sleep(1200);

    const o = computeOverlayBounds(fakeTarget.bounds);
    const pagePath = path.join(CAPTURE_DIR, 'claude-cs-overlay-page.png');
    const image = await overlay.capturePage();
    await writeFile(pagePath, image.toPNG());
    console.log(`  capturePage -> ${pagePath} (${image.getSize().width}x${image.getSize().height})`);

    // 화면 캡처는 Screen Recording 권한이 필요하다. 실패하면 사유를 그대로 드러낸다.
    const screenPath = path.join(CAPTURE_DIR, 'claude-cs-overlay-screen.png');
    const pad = 60;
    const rect = `${o.x - pad},${o.y - pad},${o.width + pad * 2},${o.height + pad * 2}`;
    try {
      await execFileAsync('screencapture', ['-x', '-R', rect, screenPath]);
      console.log(`  screencapture -R ${rect} -> ${screenPath}`);
    } catch (error) {
      console.error('  screencapture 실패:', error.message.split('\n')[0]);
    }

    // 체형 4단계를 각각 렌더한다 (FR-11 / FR-12 육안 검증).
    // 주입은 실제 경로와 같은 overlay:usage 채널로 한다. 렌더러에 테스트용 구멍을 내지 않는다.
    if (wantFatness) {
      console.log('--- fatness stages ---');
      for (const percent of [0, 40, 80, 100]) {
        const body = computeFatness(percent);
        overlay.send('overlay:usage', {
          limitMode: '5h',
          usedPercentage: percent,
          fatness: body.fatness,
          stage: body.stage,
          nextResetAt: null,
          tokensPerMinute: 0,
          isIdle: false,
          hasData: true,
          windows: { five_hour: { usedPercentage: percent, resetsAt: null }, seven_day: null },
        });
        // --fatness-transition 이 600ms 다. 보간이 끝난 뒤 찍어야 최종 체형이 나온다.
        await sleep(900);

        const file = path.join(CAPTURE_DIR, `claude-cs-fatness-${percent}.png`);
        const shot = await overlay.capturePage();
        await writeFile(file, shot.toPNG());
        console.log(`  ${String(percent).padStart(3)}% ${body.stage.padEnd(6)} -> ${file}`);
      }
    }

    // 상태별 모션을 렌더한다 (PRD §2.3 육안 검증).
    // 애니메이션은 정지 화면으로 안 보이지만, 기절 자세와 리셋 카운트다운은 확인된다.
    if (wantStates) {
      console.log('--- character states ---');
      const cases = [
        { state: 'WORKING', percent: 20, tokensPerMinute: 18000 },
        { state: 'IDLE', percent: 20, tokensPerMinute: 0 },
        { state: 'WORKING', percent: 80, tokensPerMinute: 18000, label: 'WORKING-fat' },
        { state: 'EXHAUSTED', percent: 100, tokensPerMinute: 0 },
      ];

      for (const { state, percent, tokensPerMinute, label } of cases) {
        const body = computeFatness(percent);
        overlay.send('overlay:usage', {
          limitMode: '5h',
          usedPercentage: percent,
          fatness: body.fatness,
          stage: body.stage,
          // 기절 캡처에서 카운트다운이 보이도록 리셋을 1시간 23분 뒤로 둔다.
          nextResetAt: Date.now() + 83 * 60_000,
          tokensPerMinute,
          intake: computeIntake(tokensPerMinute),
          isIdle: state === 'IDLE',
          hasData: true,
          windows: { five_hour: { usedPercentage: percent, resetsAt: null }, seven_day: null },
        });
        overlay.send('overlay:character', { state, previous: null, reason: 'diag' });
        await sleep(900);

        const name = label ?? state;
        const file = path.join(CAPTURE_DIR, `claude-cs-state-${name}.png`);
        const shot = await overlay.capturePage();
        await writeFile(file, shot.toPNG());
        console.log(`  ${name.padEnd(12)} -> ${file}`);
      }
    }

    overlay.destroy();
  }

  console.log(`\nRESULT: ${ok ? 'ALL CHECKS PASS' : 'SOME CHECKS FAILED'}`);
  app.exit(ok ? 0 : 1);
}
