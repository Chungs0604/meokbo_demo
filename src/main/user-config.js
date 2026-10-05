import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * userData/config.json 을 읽는다. Phase 1 에서 쓰는 건 터미널 화이트리스트 확장뿐이다.
 * Phase 2 에서 한도 모드(limitMode) 저장소로 확장한다.
 */
const DEFAULTS = {
  extraTerminalBundleIds: [],
  extraTerminalAppNames: [],
};

export function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

export function loadUserConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) {
    return { ...DEFAULTS };
  }

  // 설정 파일이 깨졌으면 조용히 기본값으로 넘기지 않고 드러낸다 (NFR-04).
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    console.error(`[config] ${file} 를 읽을 수 없다:`, error.message);
    return { ...DEFAULTS };
  }

  try {
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (error) {
    console.error(`[config] ${file} 가 올바른 JSON 이 아니다. 기본값을 사용한다:`, error.message);
    return { ...DEFAULTS };
  }
}
