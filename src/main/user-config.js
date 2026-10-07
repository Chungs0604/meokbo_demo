import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/** userData/config.json 로더. 터미널 화이트리스트 확장과 한도 모드를 담는다. */
const DEFAULTS = {
  extraTerminalBundleIds: [],
  extraTerminalAppNames: [],
  /** '5h' | 'weekly' — 기본은 5시간 한도 (FR-10). */
  limitMode: '5h',
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

/**
 * `patch` 의 키만 덮어써 저장한다. 사용자가 손으로 적어 둔 다른 키
 * (터미널 화이트리스트 등)를 날리지 않으려고 저장 직전에 다시 읽는다.
 *
 * 임시 파일에 쓰고 rename 하는 이유는 저장 도중 앱이 죽으면 반쯤 쓰인 JSON 이 남아
 * 다음 실행에서 설정을 통째로 잃기 때문이다. rename 은 같은 볼륨에서 원자적이다.
 *
 * 저장 실패는 삼키지 않는다 — 호출한 쪽이 사용자에게 알릴지 정한다.
 */
export function saveUserConfig(patch) {
  const file = configPath();
  const merged = { ...loadUserConfig(), ...patch };
  const temp = `${file}.tmp`;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
  return merged;
}
