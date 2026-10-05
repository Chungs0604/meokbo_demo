'use strict';

const stage = document.getElementById('stage');
const debugPanel = document.getElementById('debug');
const api = window.claudeCS;

if (!api) {
  // preload 가 붙지 않으면 캐릭터는 영원히 숨은 상태로 남는다. 조용히 넘기지 않는다.
  console.error('[overlay] preload 브리지(window.claudeCS)가 없다.');
} else {
  debugPanel.hidden = !api.debug;

  api.onState((state) => {
    stage.dataset.state = state.visible ? 'visible' : 'hidden';

    if (!api.debug) return;

    debugPanel.textContent = state.visible
      ? [
          state.target.appName,
          `win  ${fmt(state.target.bounds)}`,
          `self ${fmt(state.overlayBounds)}`,
        ].join('\n')
      : `hidden: ${state.reason ?? '-'}`;
  });
}

function fmt(r) {
  return `${r.x},${r.y} ${r.width}x${r.height}`;
}
