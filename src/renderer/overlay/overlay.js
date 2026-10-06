'use strict';

const stage = document.getElementById('stage');
const countdown = document.getElementById('countdown');
const debugPanel = document.getElementById('debug');
const layers = [document.getElementById('layer-a'), document.getElementById('layer-b')];
const api = window.claudeCS;

/** 시트의 행 번호. scripts/build-sheet.mjs 의 STAGE_ORDER 와 같은 순서다. */
const STAGE_ROWS = { slim: 0, chubby: 1, fat: 2, limit: 3 };

/** 지금 보이는 레이어와 그 행. 크로스페이드는 둘을 번갈아 쓴다. */
let frontLayer = 0;
let shownRow = null;
let stackOrder = 0;

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
    // 체형·밥 먹는 세기는 main 이 계산을 끝냈다. 렌더러는 그림만 고른다.
    // 사용률을 모르는 동안은 아무것도 안 바꾼다 — 첫 스냅샷 전에는 체형을 알 수 없다.
    if (typeof usage.fatness === 'number') {
      document.documentElement.style.setProperty('--fatness', usage.fatness.toFixed(3));
      stage.dataset.stage = usage.stage;
      showStage(usage.stage);
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

/**
 * 체형 그림을 바꾼다 (FR-12).
 *
 * 그림이 4단계뿐이라 플레이스홀더처럼 폭을 연속으로 늘릴 수 없다. 그래서 레이어 두 장을
 * 겹쳐 두고 새 체형을 위에서 페이드 인 시킨다. 아래 레이어는 가려진 채 남아 있다가
 * 다음 전환 때 재사용된다.
 */
function showStage(name) {
  const row = STAGE_ROWS[name];
  if (row === undefined || row === shownRow) return;

  if (shownRow === null) {
    // 첫 표시는 섞을 상대가 없다. 바로 보여준다.
    const layer = layers[frontLayer];
    layer.style.setProperty('--row', row);
    layer.style.opacity = '1';
    shownRow = row;
    return;
  }

  const next = layers[1 - frontLayer];
  next.style.setProperty('--row', row);
  next.style.zIndex = String(++stackOrder);
  // 직전 전환에서 쓰던 레이어라 opacity 가 1 로 남아 있다.
  // 전환을 끈 채 0 으로 되돌리고 리플로우를 강제해야 0 → 1 이 실제로 애니메이션된다.
  next.style.transition = 'none';
  next.style.opacity = '0';
  void next.offsetWidth;
  next.style.transition = '';
  next.style.opacity = '1';

  frontLayer = 1 - frontLayer;
  shownRow = row;
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
