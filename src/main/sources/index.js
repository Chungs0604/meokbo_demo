import process from 'node:process';

/**
 * 플랫폼에 맞는 창 소스를 고른다. 각 소스는 같은 이벤트 계약(`sample` / `error`)을 따른다.
 *
 * 동적 import 를 쓰는 이유: 비 macOS 폴백은 선택 의존성(get-windows)을 요구하는데,
 * macOS 에서까지 그걸 로드하다 깨지면 안 된다.
 */
export async function createWindowSource() {
  if (process.platform === 'darwin') {
    const { MacOSWindowSource } = await import('./macos-window-source.js');
    return new MacOSWindowSource();
  }
  const { PollingWindowSource } = await import('./polling-window-source.js');
  return new PollingWindowSource();
}
