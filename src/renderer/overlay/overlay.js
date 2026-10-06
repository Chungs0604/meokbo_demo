'use strict';

const stage = document.getElementById('stage');
const debugPanel = document.getElementById('debug');
const api = window.claudeCS;

/** 추적 상태와 사용량이 각각 다른 채널로 오므로 줄을 따로 들고 합쳐 찍는다. */
const debugLines = { track: '', usage: '' };

if (!api) {
  // preload 가 붙지 않으면 캐릭터는 영원히 숨은 상태로 남는다. 조용히 넘기지 않는다.
  console.error('[overlay] preload 브리지(window.claudeCS)가 없다.');
} else {
  debugPanel.hidden = !api.debug;

  api.onState((state) => {
    stage.dataset.state = state.visible ? 'visible' : 'hidden';

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
    // 체형 계산은 main 이 끝냈다. 렌더러는 변수에 꽂고 CSS transition 에 보간을 맡긴다 (FR-12).
    // 사용률을 모르는 동안은 CSS 기본값(--fatness: 0, 홀쭉)을 그대로 둔다.
    if (typeof usage.fatness === 'number') {
      // --body-width / --body-height 가 :root 에 선언돼 있어 :root 에 꽂아야 전파된다.
      document.documentElement.style.setProperty('--fatness', usage.fatness.toFixed(3));
      stage.dataset.stage = usage.stage;
    }

    if (!api.debug) return;

    debugLines.usage = typeof usage.usedPercentage === 'number'
      ? `${usage.limitMode} ${usage.usedPercentage.toFixed(1)}% ${usage.stage}`
        + ` ${usage.isIdle ? 'idle' : 'work'} ${usage.tokensPerMinute}tpm`
      : 'usage: 수치 없음';
    renderDebug();
  });
}

function renderDebug() {
  debugPanel.textContent = [debugLines.track, debugLines.usage].filter(Boolean).join('\n');
}

function fmt(r) {
  return `${r.x},${r.y} ${r.width}x${r.height}`;
}
