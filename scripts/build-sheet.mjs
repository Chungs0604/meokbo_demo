/**
 * 낱장 PNG → 스프라이트 시트.  실행: npm run build:sheet
 *
 * 생성 AI 가 내놓은 프레임은 (1) 투명 배경 대신 체크무늬를 **그려서** 주고
 * (2) 캔버스 크기와 캐릭터 위치가 제각각이다. 그대로 재생하면 캐릭터가 덜덜 떤다.
 * 이 스크립트가 배경을 지우고 앵커를 맞춰 떨림을 없앤다.
 *
 * Electron 의 nativeImage 만 쓴다 — 이미지 라이브러리를 받지 않으려는 것이다
 * (런타임 의존성 0개 원칙, Phase 1 산출물).
 */
import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'assets', 'raw');
const OUT = path.join(ROOT, 'src', 'renderer', 'overlay', 'assets');

/** 레티나(2x). 실측 디스플레이가 2x 라 1x 로 구우면 흐려진다. */
const SCALE = 2;

/**
 * 셀 크기(1x 기준). 캐릭터가 세로로 길어서(폭:높이 = 0.59) 가로로 납작했던
 * Phase 1 플레이스홀더(120x84)와 비율이 반대다.
 * 좌우 여백 15px 는 뒹굴기(±9도 회전) 때 몸이 잘리지 않을 만큼 잡은 값이다.
 */
const CELL = { width: 96, height: 128 };
/** 셀 안에서 캐릭터가 차지할 최대 높이. 위쪽 여백은 통통 튀는 모션(-4px)이 쓴다. */
const CHAR_HEIGHT = 112;
/** 발끝이 셀 바닥에서 띄워질 높이. 0 이면 회전할 때 발이 잘린다. */
const FOOT_MARGIN = 4;

/**
 * 체형 시트의 열 순서. 파일명 알파벳순(chubby→fat→limit→slim)은 체형 순서가 아니다.
 * 렌더러가 background-position 으로 단계를 고르므로 순서가 곧 계약이다.
 * src/main/config.js 의 FATNESS_STAGES 와 같은 순서를 유지한다.
 */
const STAGE_ORDER = ['slim', 'chubby', 'fat', 'limit'];

/**
 * 체크무늬 판정.
 * 배경은 흰색(255,255,255)과 회색(203,203,203)뿐이라 **무채색이면서 밝다**.
 * 캐릭터 크림색 248,232,184 는 R-B 가 64 라 걸리지 않는다 (실측값, probe 로 확인).
 */
function isBackgroundColor(r, g, b) {
  const spread = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
  return spread <= 18 && Math.min(r, g, b) >= 185;
}

/**
 * 테두리에서 flood fill 로 배경만 지운다.
 * 색만 보고 지우면 **눈 흰자가 같이 날아간다** — 배경과 똑같은 순백이기 때문이다.
 * 바깥에서 연결된 것만 지우면 윤곽선 안쪽은 건드리지 않는다.
 */
function removeBackground(bitmap, width, height) {
  const outside = new Uint8Array(width * height);
  const stack = [];

  const at = (i) => {
    const o = i * 4;
    return [bitmap[o + 2], bitmap[o + 1], bitmap[o]]; // BGRA 라 뒤집어 읽는다
  };
  const push = (x, y) => {
    const i = y * width + x;
    if (outside[i]) return;
    const [r, g, b] = at(i);
    if (!isBackgroundColor(r, g, b)) return;
    outside[i] = 1;
    stack.push(i);
  };

  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }

  while (stack.length) {
    const i = stack.pop();
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }

  // 경계의 안티앨리어싱 픽셀은 배경과 캐릭터가 섞여 있어 테두리에 흰 띠로 남는다.
  // 배경에 닿아 있으면서 아직 밝고 무채색인 픽셀을 두 겹 더 깎아낸다.
  for (let pass = 0; pass < 2; pass++) {
    const extra = [];
    for (let i = 0; i < outside.length; i++) {
      if (outside[i]) continue;
      const [r, g, b] = at(i);
      if (!isBackgroundColor(r, g, b)) continue;
      const x = i % width;
      const y = (i - x) / width;
      const touching = (x > 0 && outside[i - 1]) || (x < width - 1 && outside[i + 1])
        || (y > 0 && outside[i - width]) || (y < height - 1 && outside[i + width]);
      if (touching) extra.push(i);
    }
    if (!extra.length) break;
    for (const i of extra) outside[i] = 1;
  }

  let cleared = 0;
  for (let i = 0; i < outside.length; i++) {
    if (!outside[i]) continue;
    bitmap[i * 4 + 3] = 0;
    cleared++;
  }
  return cleared / outside.length;
}

/**
 * 불투명 픽셀이 차지하는 사각형. 앵커를 맞추려면 이게 필요하다.
 *
 * 픽셀 하나라도 남으면 경계로 치면 안 된다 — 배경 체크무늬에 압축 잡티가 섞여 있어
 * 완전한 무채색이 아닌 점이 몇 개씩 살아남는다. 그걸 캐릭터로 세면 bbox 가 캔버스
 * 전체로 벌어진다(실측: slim-04 가 52% 대신 96% 로 잡혔다).
 * 그래서 행·열에 일정 개수 이상 모여 있을 때만 캐릭터로 본다.
 */
function opaqueBounds(bitmap, width, height) {
  const minRun = Math.max(3, Math.round(width * 0.004));
  const cols = new Uint32Array(width);
  const rows = new Uint32Array(height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bitmap[(y * width + x) * 4 + 3] < 16) continue;
      cols[x]++;
      rows[y]++;
    }
  }

  const span = (counts) => {
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] < minRun) continue;
      if (lo < 0) lo = i;
      hi = i;
    }
    return [lo, hi];
  };

  const [minX, maxX] = span(cols);
  const [minY, maxY] = span(rows);
  if (minX < 0 || minY < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * 파일명에서 체형과 프레임 번호를 읽는다.
 *   slim.png     → { stage: 'slim', frame: 0 }   (정지 포즈)
 *   slim-03.png  → { stage: 'slim', frame: 2 }   (3번째 프레임)
 */
function parseName(file) {
  const base = path.basename(file, path.extname(file));
  const match = base.match(/^([a-z]+)(?:-(\d+))?$/);
  if (!match || !STAGE_ORDER.includes(match[1])) return null;
  return { stage: match[1], frame: match[2] ? Number(match[2]) - 1 : 0 };
}

/** 체형별로 프레임을 모은다. { slim: [파일…], chubby: [...] } */
function loadFrames(dir) {
  const byStage = new Map();
  const skipped = [];

  for (const name of fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png'))) {
    const parsed = parseName(name);
    if (!parsed) {
      skipped.push(name);
      continue;
    }
    if (!byStage.has(parsed.stage)) byStage.set(parsed.stage, []);
    byStage.get(parsed.stage)[parsed.frame] = path.join(dir, name);
  }

  if (skipped.length) {
    console.error(`  이름 규칙(<체형>[-<번호>].png)에 안 맞아 건너뛴다: ${skipped.join(', ')}`);
  }
  return byStage;
}

/** 배경을 지우고 캐릭터 위치를 잰다. */
function prepare(file) {
  const img = nativeImage.createFromPath(file);
  const { width, height } = img.getSize();
  const bitmap = img.toBitmap();
  const cleared = removeBackground(bitmap, width, height);
  const box = opaqueBounds(bitmap, width, height);
  return { file, width, height, bitmap, box, cleared };
}

/**
 * 박스 필터 축소.
 *
 * `nativeImage.resize()` 를 쓰면 **알파가 사라진다** (실측: 결과 시트의 91%가 불투명해졌다).
 * 투명 배경이 생명인 오버레이라 직접 줄인다.
 * 색을 알파로 가중 평균해야 경계에 투명 픽셀의 색이 번지지 않는다.
 */
function downscale(src, srcW, srcH, dstW, dstH) {
  const dst = Buffer.alloc(dstW * dstH * 4);
  const ratioX = srcW / dstW;
  const ratioY = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    const y0 = Math.floor(dy * ratioY);
    const y1 = Math.min(srcH, Math.max(y0 + 1, Math.ceil((dy + 1) * ratioY)));
    for (let dx = 0; dx < dstW; dx++) {
      const x0 = Math.floor(dx * ratioX);
      const x1 = Math.min(srcW, Math.max(x0 + 1, Math.ceil((dx + 1) * ratioX)));

      let b = 0;
      let g = 0;
      let r = 0;
      let alphaSum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * srcW + x) * 4;
          const a = src[i + 3];
          b += src[i] * a;
          g += src[i + 1] * a;
          r += src[i + 2] * a;
          alphaSum += a;
          count++;
        }
      }

      const o = (dy * dstW + dx) * 4;
      if (alphaSum > 0) {
        dst[o] = Math.round(b / alphaSum);
        dst[o + 1] = Math.round(g / alphaSum);
        dst[o + 2] = Math.round(r / alphaSum);
        dst[o + 3] = Math.round(alphaSum / count);
      }
    }
  }
  return dst;
}

/** src 를 dst 의 (dx, dy) 위치에 알파 합성 없이 그대로 얹는다. 겹칠 일이 없어 덮어쓰면 된다. */
function blit(dst, dstW, dstH, src, srcW, srcH, dx, dy) {
  for (let y = 0; y < srcH; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dstH) continue;
    for (let x = 0; x < srcW; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dstW) continue;
      const s = (y * srcW + x) * 4;
      if (src[s + 3] === 0) continue;
      const d = (ty * dstW + tx) * 4;
      dst[d] = src[s];
      dst[d + 1] = src[s + 1];
      dst[d + 2] = src[s + 2];
      dst[d + 3] = src[s + 3];
    }
  }
}

/**
 * 한 그룹(= 한 모션)을 시트 한 장으로 굽는다.
 *
 * 배율을 **프레임마다 따로 구하지 않는다.** 그렇게 하면 모든 프레임의 캐릭터 높이가
 * 같아져서 밥 먹을 때의 squash/stretch(몸이 늘었다 눌리는 것)가 통째로 사라진다.
 * 그룹에서 가장 큰 프레임을 기준으로 **공통 배율**을 잡아 상대적 크기 차이를 살린다.
 *
 * 정렬은 발끝 기준이다. 캐릭터가 터미널 테두리 위에 올라앉아야 하므로(FR-02)
 * bbox 중심이 아니라 바닥이 고정돼야 한다.
 */
/**
 * 한 모션을 시트 한 장으로 굽는다. **행 = 체형 단계, 열 = 프레임** 으로 고정한다.
 *
 * 행이 항상 4개인 이유: 렌더러가 `background-position-y` 로 체형을 고르므로 행 번호가
 * 곧 계약이다. 아직 못 만든 체형이 있으면 홀쭉 프레임으로 메우고 경고를 띄운다 —
 * 행이 비면 그 체형에서 캐릭터가 사라져 버린다.
 *
 * 배율은 **그룹 전체 공통**이다. 프레임마다 따로 맞추면 모든 캐릭터 높이가 같아져
 * 체형 간 크기 차이와 밥 먹을 때의 squash/stretch 가 통째로 사라진다.
 */
function buildSheet(group, byStage) {
  const cellW = CELL.width * SCALE;
  const cellH = CELL.height * SCALE;
  const charH = CHAR_HEIGHT * SCALE;
  const footMargin = FOOT_MARGIN * SCALE;

  const columns = Math.max(...[...byStage.values()].map((f) => f.length));
  const all = [...byStage.values()].flat();
  // 캔버스 크기가 제각각이라 "캔버스 대비 비율"로 비교해야 공통 배율이 나온다.
  const tallest = Math.max(...all.map((f) => f.box.height / f.height));

  const sheetW = cellW * columns;
  const sheetH = cellH * STAGE_ORDER.length;
  const sheet = Buffer.alloc(sheetW * sheetH * 4);
  const filled = [];

  STAGE_ORDER.forEach((stage, row) => {
    let frames = byStage.get(stage);
    if (!frames?.length) {
      frames = byStage.get('slim');
      filled.push(stage);
    }
    if (!frames?.length) return;

    for (let column = 0; column < columns; column++) {
      // 프레임 수가 모자라면 마지막 프레임을 늘려 쓴다. 중간이 비면 재생이 끊긴다.
      const frame = frames[column] ?? frames[frames.length - 1];
      const relative = (frame.box.height / frame.height) / tallest;
      const scale = (charH * relative) / frame.box.height;

      const size = {
        width: Math.max(1, Math.round(frame.width * scale)),
        height: Math.max(1, Math.round(frame.height * scale)),
      };
      const bits = downscale(frame.bitmap, frame.width, frame.height, size.width, size.height);

      const centerX = (frame.box.x + frame.box.width / 2) * scale;
      const footY = (frame.box.y + frame.box.height) * scale;
      const dx = Math.round(column * cellW + cellW / 2 - centerX);
      const dy = Math.round(row * cellH + cellH - footMargin - footY);

      blit(sheet, sheetW, sheetH, bits, size.width, size.height, dx, dy);
    }
  });

  if (filled.length) {
    console.error(`  ⚠ ${filled.join(', ')} 프레임이 없어 홀쭉으로 메웠다. 해당 체형에서는 같은 그림이 나온다`);
  }

  const out = nativeImage.createFromBitmap(sheet, { width: sheetW, height: sheetH });
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${group}.png`);
  fs.writeFileSync(file, out.toPNG());
  return { file, columns, width: sheetW, height: sheetH };
}

app.whenReady().then(() => {
  const groups = fs.readdirSync(RAW).filter((d) => fs.statSync(path.join(RAW, d)).isDirectory());

  console.log(`셀 ${CELL.width}x${CELL.height} @${SCALE}x = ${CELL.width * SCALE}x${CELL.height * SCALE}px`);

  for (const group of groups) {
    console.log(`\n=== ${group} ===`);
    const byStage = new Map();

    for (const [stage, files] of loadFrames(path.join(RAW, group))) {
      const prepared = [];
      for (const file of files) {
        if (!file) continue;
        const frame = prepare(file);
        if (!frame.box) {
          console.error(`  ${path.basename(file)} 캐릭터를 못 찾았다. 건너뛴다`);
          continue;
        }
        prepared.push(frame);
      }
      if (prepared.length) byStage.set(stage, prepared);
      console.log(`  ${stage.padEnd(7)} ${String(prepared.length).padStart(2)} 프레임`
        + `  배경 제거 ${(prepared.reduce((a, f) => a + f.cleared, 0) / prepared.length * 100).toFixed(0)}%`);
    }

    if (!byStage.size) continue;
    const result = buildSheet(group, byStage);
    console.log(`  → ${path.relative(ROOT, result.file)}  ${result.width}x${result.height}`
      + `  (${STAGE_ORDER.length}행 x ${result.columns}열)`);
  }
  app.exit(0);
});
