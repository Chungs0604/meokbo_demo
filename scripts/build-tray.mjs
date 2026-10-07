/**
 * body 스프라이트 시트 → 메뉴바 트레이 아이콘.  실행: npm run build:tray
 *
 * 트레이 아이콘은 체형 4단계가 각각 하나씩이다. 사용률이 오르면 메뉴바 아이콘도
 * 같이 차올라서, 캐릭터를 안 보고도 상태를 안다.
 *
 * **단계 구분은 실루엣 폭이 아니라 '채움'이 한다.** 원본 그림의 chubby 와 fat 은
 * 몸통 폭이 117px 로 똑같고 높이만 7px 다르다(실측). 폭에 기대면 뒤의 세 단계가
 * 메뉴바에서 구분이 안 돼서, 윤곽선 안쪽을 아래부터 채우는 방식으로 바꿨다.
 *
 * **macOS 템플릿 이미지라 색이 없다 — 검정 + 알파뿐이다.** 그래야 OS 가 다크 모드에서
 * 흰색으로, 메뉴를 펼친 상태에서 또 다르게 자동 반전해 준다. 색을 넣으면 반전이 막혀
 * 다크 모드에서 검은 배경에 묻힌다.
 *
 * 원본은 이미 커밋된 `body.png` 라 생성 AI 원본(assets/raw/, .gitignore)이 없어도
 * 다시 구울 수 있다.
 */
import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHEET = path.join(ROOT, 'src', 'renderer', 'overlay', 'assets', 'body.png');
const OUT = path.join(ROOT, 'src', 'main', 'assets');

/** `config.js` 의 FATNESS_STAGES 와 같은 순서. 시트의 행 순서가 이것이다. */
const STAGE_ORDER = ['slim', 'chubby', 'fat', 'limit'];

/** body 시트는 모션이 없어 1열이다. */
const SHEET_COLUMNS = 1;

/** 메뉴바 아이콘 크기(1x). 레티나는 @2x(32px)를 쓴다. */
const ICON_SIZE = 16;
const RETINA_SCALE = 2;

/**
 * 글리프가 캔버스에서 차지하는 비율.
 *
 * 애플 HIG 는 메뉴바 아이콘 주위에 여백을 요구한다. 꽉 채우면 옆 아이콘과 붙어 보이고,
 * 축소할 때 가장자리 픽셀이 잘린다.
 */
const GLYPH_RATIO = 0.8;

/**
 * 윤곽선 두께 (캔버스 변 대비).
 *
 * 꽉 찬 실루엣 대신 윤곽선을 쓰는 이유는 메뉴바의 다른 아이콘(와이파이·배터리)이
 * 전부 이 밀도이기 때문이다. 검정 덩어리는 혼자 무겁게 튄다.
 * 6% 는 32px 에서 2px 다 — 이보다 얇으면 축소할 때 회색으로 녹는다.
 */
const STROKE_RATIO = 0.06;

/** 알파 이진화 임계값. 스프라이트 가장자리의 반투명 픽셀을 윤곽선 계산에서 배제한다. */
const ALPHA_THRESHOLD = 110;

/**
 * 체형 단계별 채움 높이 (**배 높이** 대비, 아래부터).
 *
 * `FATNESS_STAGES` 의 경계(34 / 67 / 100%)를 그대로 옮긴 것이 아니라 네 단계를
 * 균등하게 나눈 값이다. 16px 에서 1/3 과 34% 를 구별할 방법이 없고, 눈으로 "비었다 /
 * 반쯤 / 거의 / 꽉"을 읽히게 하는 쪽이 목적이다.
 */
const FILL_LEVELS = { slim: 0, chubby: 0.34, fat: 0.67, limit: 1 };

/**
 * 배와 목을 가르는 폭 (그 단계 최대 폭 대비).
 *
 * 채움 기준이 몸통 bbox 전체면 **67% 와 100% 가 구별되지 않는다** — 위쪽 1/3 이
 * 가느다란 목과 귀라서 배는 이미 꽉 차 있기 때문이다. 네 단계를 배 높이에 고르게
 * 펼치려고 배만 따로 잰다.
 */
const BELLY_WIDTH_RATIO = 0.6;

/** 시트의 한 행에서 알파 채널만 떼어낸다. 템플릿 아이콘은 색을 쓰지 않는다. */
function extractAlpha(bitmap, sheetW, cellW, cellH, row) {
  const alpha = new Uint8Array(cellW * cellH);
  const originY = row * cellH;
  for (let y = 0; y < cellH; y++) {
    for (let x = 0; x < cellW; x++) {
      alpha[y * cellW + x] = bitmap[((originY + y) * sheetW + x) * 4 + 3];
    }
  }
  return alpha;
}

function opaqueBounds(alpha, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] <= 16) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * 윤곽선 + 아래부터 `level` 만큼 채운 글리프.
 *
 * 선은 **안쪽으로만** 파고든다 (침식 후 빼기). 바깥으로 팽창시키면 글리프가 캔버스
 * 여백을 먹어 메뉴바에서 옆 아이콘과 붙는다.
 *
 * 채움 경계는 배 구간 기준이라 단계마다 몸통 높이가 달라도 같은 비율로 보인다.
 */
function glyph(mask, width, height, radius, belly, level) {
  const result = new Uint8Array(width * height);
  const fillTop = belly.bottom - Math.round(belly.height * level);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (y >= fillTop) {
        result[y * width + x] = 255;
        continue;
      }
      let interior = true;
      for (let dy = -radius; dy <= radius && interior; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || nx < 0 || ny >= height || nx >= width || !mask[ny * width + nx]) {
            interior = false;
            break;
          }
        }
      }
      if (!interior) result[y * width + x] = 255;
    }
  }
  return result;
}

/**
 * 박스 필터 축소. `build-sheet.mjs` 와 같은 이유로 `nativeImage.resize()` 를 안 쓴다
 * (알파가 날아간다). 여기는 알파만 다루므로 색 가중 평균이 필요 없다.
 */
function downscaleAlpha(src, srcSize, dstSize) {
  const dst = new Uint8Array(dstSize * dstSize);
  const ratio = srcSize / dstSize;
  for (let dy = 0; dy < dstSize; dy++) {
    const y0 = Math.floor(dy * ratio);
    const y1 = Math.min(srcSize, Math.max(y0 + 1, Math.ceil((dy + 1) * ratio)));
    for (let dx = 0; dx < dstSize; dx++) {
      const x0 = Math.floor(dx * ratio);
      const x1 = Math.min(srcSize, Math.max(x0 + 1, Math.ceil((dx + 1) * ratio)));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += src[y * srcSize + x];
          count++;
        }
      }
      dst[dy * dstSize + dx] = Math.round(sum / count);
    }
  }
  return dst;
}

/**
 * 배 구간을 잰다 — 행별 폭이 최대 폭의 `BELLY_WIDTH_RATIO` 이상인 가장 윗줄부터 바닥까지.
 * 목과 귀처럼 가느다란 윗부분을 채움 계산에서 뺀다.
 */
function bellyBounds(mask, width, top, bottom) {
  const spans = [];
  for (let y = top; y < bottom; y++) {
    let span = 0;
    for (let x = 0; x < width; x++) if (mask[y * width + x]) span++;
    spans.push(span);
  }
  const widest = Math.max(...spans);
  const index = spans.findIndex((span) => span >= widest * BELLY_WIDTH_RATIO);
  const bellyTop = top + (index < 0 ? 0 : index);
  return { bottom, height: bottom - bellyTop };
}

/** 알파 배열 → BGRA PNG. 색은 전부 검정이다 (템플릿 이미지). */
function toPng(alpha, size) {
  const bgra = Buffer.alloc(size * size * 4);
  for (let i = 0; i < alpha.length; i++) bgra[i * 4 + 3] = alpha[i];
  return nativeImage.createFromBitmap(bgra, { width: size, height: size }).toPNG();
}

app.whenReady().then(() => {
  const sheet = nativeImage.createFromPath(SHEET);
  const { width: sheetW, height: sheetH } = sheet.getSize();
  if (!sheetW) {
    console.error(`시트를 못 읽었다: ${SHEET}`);
    app.exit(1);
    return;
  }

  const bitmap = sheet.toBitmap();
  const cellW = sheetW / SHEET_COLUMNS;
  const cellH = sheetH / STAGE_ORDER.length;

  const stages = STAGE_ORDER.map((stage, row) => {
    const alpha = extractAlpha(bitmap, sheetW, cellW, cellH, row);
    return { stage, alpha, box: opaqueBounds(alpha, cellW, cellH) };
  });

  /**
   * **네 단계가 같은 배율을 써야 한다.** 각자 제 bbox 에 맞춰 키우면 홀쭉이도 뚱뚱이도
   * 같은 크기로 보여서 체형 신호가 사라진다. 가장 큰 변을 기준으로 정사각을 잡고
   * 나머지는 그 안에 가운데 정렬한다.
   */
  const longest = Math.max(...stages.map((s) => Math.max(s.box.width, s.box.height)));
  const canvas = Math.round(longest / GLYPH_RATIO);
  const radius = Math.max(1, Math.round(canvas * STROKE_RATIO));

  fs.mkdirSync(OUT, { recursive: true });

  for (const { stage, alpha, box } of stages) {
    const mask = new Uint8Array(canvas * canvas);
    const offsetX = Math.round((canvas - box.width) / 2);
    const offsetY = Math.round((canvas - box.height) / 2);
    for (let y = 0; y < box.height; y++) {
      for (let x = 0; x < box.width; x++) {
        const a = alpha[(box.y + y) * cellW + (box.x + x)];
        mask[(offsetY + y) * canvas + (offsetX + x)] = a > ALPHA_THRESHOLD ? 1 : 0;
      }
    }

    const level = FILL_LEVELS[stage] ?? 0;
    const belly = bellyBounds(mask, canvas, offsetY, offsetY + box.height);
    const drawn = glyph(mask, canvas, canvas, radius, belly, level);

    const sizes = [ICON_SIZE, ICON_SIZE * RETINA_SCALE];
    for (const size of sizes) {
      const suffix = size === ICON_SIZE ? '' : `@${size / ICON_SIZE}x`;
      const file = path.join(OUT, `tray-${stage}${suffix}.png`);
      fs.writeFileSync(file, toPng(downscaleAlpha(drawn, canvas, size), size));
    }

    const ink = drawn.reduce((acc, v) => acc + (v ? 1 : 0), 0);
    console.log(`  ${stage.padEnd(7)} 몸통 ${String(box.width).padStart(3)}x${box.height}`
      + `  배 ${String(belly.height).padStart(3)}px`
      + `  채움 ${String(Math.round(level * 100)).padStart(3)}%`
      + `  먹물 ${(ink / (canvas * canvas) * 100).toFixed(1)}%`);
  }

  console.log(`→ ${path.relative(ROOT, OUT)}/tray-<체형>.png  ${ICON_SIZE}px + @${RETINA_SCALE}x`);
  app.exit(0);
});
