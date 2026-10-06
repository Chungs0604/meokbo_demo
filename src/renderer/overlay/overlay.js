'use strict';

const stage = document.getElementById('stage');
const countdown = document.getElementById('countdown');
const debugPanel = document.getElementById('debug');
const api = window.claudeCS;

/** 추적 상태·사용량·캐릭터 상태가 각각 다른 채널로 오므로 줄을 따로 들고 합쳐 찍는다. */
const debugLines = { track: '', usage: '', character: '' };

/** 카운트다운은 훅이 아니라 시계로 센다. 이유는 tickCountdown 주석에 있다. */
let nextResetAt = null;
let countdownTimer = null;

if (!api) {
  // preload 가 붙지 않으면 캐릭터는 영원히 숨은 상태로 남는다. 조용히 넘기지 않는다.
  console.error('[overlay] preload 브리지(window.claudeCS)가 없다.');
} else {
  debugPanel.hidden = !api.debug;

  api.onState((state) => {
    stage.dataset.state = state.visible ? 'visible' : 'hidden';
    // 디버그일 때 창이 위로 늘어난다. 늘어난 만큼 캐릭터를 내려 제자리에 둔다.
    // 숨을 때는 topGap 이 안 오므로 건드리지 않는다 (다시 보일 때 다시 온다).
    if (state.visible) {
      document.documentElement.style.setProperty('--panel-h', `${state.topGap ?? 0}px`);
    }

    if (!api.debug) return;

    debugLines.track = state.visible
      ? [
          state.target.appName,
          `win  ${fmt(state.target.bounds)}`,
          `self ${fmt(state.overlayBounds)}`,
        ].join('\n')
      : `hidden: ${state.reason ?? '-'}`;
    renderDebug();
  });

  api.onUsage((usage) => {
    // 체형·밥 먹는 세기는 main 이 계산을 끝냈다. 렌더러는 변수에 꽂고 보간만 맡긴다.
    // 사용률을 모르는 동안은 CSS 기본값(--fatness: 0, 홀쭉)을 그대로 둔다.
    if (typeof usage.fatness === 'number') {
      // --body-width / --body-height 가 :root 에 선언돼 있어 :root 에 꽂아야 전파된다.
      document.documentElement.style.setProperty('--fatness', usage.fatness.toFixed(3));
      stage.dataset.stage = usage.stage;
    }
    document.documentElement.style.setProperty('--intake', (usage.intake ?? 0).toFixed(3));

    nextResetAt = usage.nextResetAt;
    tickCountdown();

    if (!api.debug) return;

    debugLines.usage = typeof usage.usedPercentage === 'number'
      ? `${usage.limitMode} ${usage.usedPercentage.toFixed(1)}% ${usage.stage}`
        + ` ${usage.tokensPerMinute}tpm`
      : 'usage: 수치 없음';
    renderDebug();
  });

  api.onCharacter(({ state, reason }) => {
    stage.dataset.character = state;
    // 기절했을 때만 카운트다운을 돌린다. 평소엔 1초 타이머를 돌릴 이유가 없다.
    if (state === 'EXHAUSTED') startCountdown();
    else stopCountdown();

    if (!api.debug) return;
    debugLines.character = `state: ${state} (${reason})`;
    renderDebug();
  });
}

function startCountdown() {
  tickCountdown();
  if (countdownTimer === null) countdownTimer = setInterval(tickCountdown, 1000);
}

function stopCountdown() {
  if (countdownTimer !== null) clearInterval(countdownTimer);
  countdownTimer = null;
  countdown.textContent = '';
}

/**
 * 리셋까지 남은 시간 (FR-22).
 *
 * main 에 물어보지 않고 렌더러가 직접 센다. statusLine 은 Claude Code 가 화면을 그릴 때만
 * 호출되므로, 기절해서 아무것도 안 하는 동안에는 새 수치가 영영 안 온다 (Phase 2 실측:
 * 03:20 리셋을 09:1x 에야 알았다). 받아둔 시각 하나로 시계를 돌리는 게 유일한 방법이다.
 */
function tickCountdown() {
  if (typeof nextResetAt !== 'number') {
    countdown.textContent = '';
    return;
  }

  const remain = Math.max(0, nextResetAt - Date.now());
  const total = Math.floor(remain / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  countdown.textContent = h > 0
    ? `${h}:${pad(m)}:${pad(s)}`
    : `${m}:${pad(s)}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function renderDebug() {
  debugPanel.textContent = [debugLines.track, debugLines.character, debugLines.usage]
    .filter(Boolean)
    .join('\n');
}

function fmt(r) {
  return `${r.x},${r.y} ${r.width}x${r.height}`;
}
