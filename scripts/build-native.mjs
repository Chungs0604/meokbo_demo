/**
 * macOS 네이티브 창 감시 헬퍼를 빌드한다.  실행: npm run build:native
 * 소스가 바이너리보다 새로울 때만 다시 컴파일한다.
 * macOS 가 아니면 조용히 건너뛴다 (그 경우 get-windows 폴백을 쓴다).
 */
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'native', 'macos', 'window-watcher.swift');
const outDir = path.join(root, 'native', 'macos', 'bin');
const binary = path.join(outDir, 'window-watcher');

if (process.platform !== 'darwin') {
  console.log('[build:native] macOS 가 아니라 건너뛴다. get-windows 폴백을 사용한다.');
  process.exit(0);
}

if (fs.existsSync(binary) && fs.statSync(binary).mtimeMs >= fs.statSync(source).mtimeMs) {
  console.log('[build:native] 최신 상태라 건너뛴다.');
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
console.log('[build:native] swiftc 로 컴파일한다...');
try {
  execFileSync('swiftc', ['-O', '-o', binary, source], { stdio: 'inherit' });
} catch (error) {
  console.error('[build:native] 컴파일 실패.');
  console.error('[build:native] Xcode Command Line Tools 가 필요하다: xcode-select --install');
  throw error;
}
console.log(`[build:native] 완료: ${binary}`);
