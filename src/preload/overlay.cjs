'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** main → 렌더러 단방향 수신 채널 하나를 그대로 노출하는 헬퍼. */
function receiver(channel) {
  return (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  };
}

/**
 * 렌더러에는 상태 "수신" 채널만 노출한다.
 * 오버레이가 main 을 호출할 일이 아직 없으므로 보내는 쪽은 열지 않는다.
 */
contextBridge.exposeInMainWorld('claudeCS', {
  onState: receiver('overlay:state'),
  onUsage: receiver('overlay:usage'),
  // sandbox 프리로드의 process 는 폴리필 서브셋이라 방어적으로 읽는다.
  debug: typeof process !== 'undefined' && process.env?.CLAUDE_CS_DEBUG === '1',
});
