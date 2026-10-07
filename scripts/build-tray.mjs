/**
 * body 스프라이트 시트 → 메뉴바 트레이 아이콘 재료.  실행: npm run build:tray
 *
 * 트레이는 사용률을 **연속으로** 보여준다. 그래서 완성된 아이콘이 아니라 재료 두 장을
 * 굽는다 — 빈 몸통(`empty`)과 꽉 찬 몸통(`full`). 둘을 사용률 높이에서 잘라 붙이는 일은
 * `src/main/tray.js` 가 런타임에 한다.
 *
 * **몸통 모양은 하나다.** 오버레이 캐릭터와 달리 체형 4단계를 쓰지 않는다. 14px 폭에서
 * 실루엣 차이는 읽히지 않고(원본의 chubby 와 fat 은 몸통 폭이 117px 로 아예 같다),
 * 메뉴바에서는 "얼마나 찼는지" 하나만 보이는 쪽이 명확하다.
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
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHEET = path.join(ROOT, 'src', 'renderer', 'overlay', 'assets', 'body.png');
const OUT = path.join(ROOT, 'src', 'main', 'assets');

/** `config.js` 의 FATNESS_STAGES 순서. 시트의 행 순서가 이것이다. */
const STAGE_ORDER = ['slim', 'chubby', 'fat', 'limit'];

/**
 * 트레이에 쓸 몸통.
 *
 * 홀쭉이는 다리가 드러나 배 구간이 좁고, 한계 체형은 이미 꽉 찬 인상이라 게이지로 쓰기에
 * 나쁘다. 가운데 체형이 배가 가장 반듯해서 채움 눈금이 고르게 올라온다.
 */
const BODY_STAGE = 'chubby';

/** body 시트는 모션이 없어 1열이다. */
const SHEET_COLUMNS = 1;

/**
 * 아이콘 높이(1x). 레티나는 2x 를 쓴다.
 *
 * **폭은 몸통 비율이 정한다 — 정사각으로 만들지 않는다.** 캐릭터는 세로로 길어서
 * 정사각에 넣으면 좌우가 빈 여백이 되고, 같은 높이 안에서 글리프가 그만큼 작아 보인다.
 * 메뉴바는 높이만 제한하므로 폭은 남는 만큼 써도 된다.
 */
const ICON_HEIGHT = 18;
const RETINA_SCALE = 2;

/**
 * 글리프가 캔버스에서 차지하는 비율.
 *
 * 애플 HIG 는 메뉴바 아이콘 주위에 여백을 요구한다. 꽉 채우면 옆 아이콘과 붙어 보이고,
 * 축소할 때 가장자리 픽셀이 잘린다.
 */
const GLYPH_RATIO = 0.94;

/**
 * 윤곽선 두께 (캔버스 높이 대비).
 *
 * 꽉 찬 실루엣 대신 윤곽선을 쓰는 이유는 메뉴바의 다른 아이콘(와이파이·배터리)이
 * 전부 이 밀도이기 때문이다. 검정 덩어리는 혼자 무겁게 튄다.
 * 5% 는 36px(2x) 에서 1.8px 다 — 이보다 얇으면 축소할 때 회색으로 녹는다.
 */
const STROKE_RATIO = 0.05;

/** 알파 이진화 임계값. 스프라이트 가장자리의 반투명 픽셀을 윤곽선 계산에서 배제한다. */
const ALPHA_THRESHOLD = 110;

/**
 * 배와 목을 가르는 폭 (몸통 최대 폭 대비).
 *
 * 채움 범위가 몸통 전체면 **윗부분이 가느다란 목과 귀라서** 67% 만 채워도 배가 이미
 * 꽉 차 보이고, 거기서 100% 까지는 변화가 없다. 눈금이 고르게 올라오도록 배만 잰다.
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
 * 윤곽선만 남긴다 (침식 후 빼기).
 *
 * 선은 **안쪽으로만** 파고든다. 바깥으로 팽창시키면 글리프가 캔버스 여백을 먹어
 * 메뉴바에서 옆 아이콘과 붙는다.
 */
function outline(mask, width, height, radius) {
  const result = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
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
function downscaleAlpha(src, srcW, srcH, dstW, dstH) {
  const dst = new Uint8Array(dstW * dstH);
  const ratioX = srcW / dstW;
  const ratioY = srcH / dstH;
  for (let dy = 0; dy < dstH; dy++) {
    const y0 = Math.floor(dy * ratioY);
    const y1 = Math.min(srcH, Math.max(y0 + 1, Math.ceil((dy + 1) * ratioY)));
    for (let dx = 0; dx < dstW; dx++) {
      const x0 = Math.floor(dx * ratioX);
      const x1 = Math.min(srcW, Math.max(x0 + 1, Math.ceil((dx + 1) * ratioX)));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += src[y * srcW + x];
          count++;
        }
      }
      dst[dy * dstW + dx] = Math.round(sum / count);
    }
  }
  return dst;
}

/** 행별 폭이 최대 폭의 `BELLY_WIDTH_RATIO` 이상인 가장 윗줄. 목·귀를 채움에서 뺀다. */
function bellyTop(mask, width, top, bottom) {
  const spans = [];
  for (let y = top; y < bottom; y++) {
    let span = 0;
    for (let x = 0; x < width; x++) if (mask[y * width + x]) span++;
    spans.push(span);
  }
  const widest = Math.max(...spans);
  const index = spans.findIndex((span) => span >= widest * BELLY_WIDTH_RATIO);
  return top + (index < 0 ? 0 : index);
}

/** 알파 배열 → BGRA PNG. 색은 전부 검정이다 (템플릿 이미지). */
function toPng(alpha, width, height) {
  const bgra = Buffer.alloc(width * height * 4);
  for (let i = 0; i < alpha.length; i++) bgra[i * 4 + 3] = alpha[i];
  return nativeImage.createFromBitmap(bgra, { width, height }).toPNG();
}

app.whenReady().then(() => {
  const sheet = nativeImage.createFromPath(SHEET);
  const { width: sheetW, height: sheetH } = sheet.getSize();
  if (!sheetW) {
    console.error(`시트를 못 읽었다: ${SHEET}`);
    app.exit(1);
    return;
  }

  const row = STAGE_ORDER.indexOf(BODY_STAGE);
  const cellW = sheetW / SHEET_COLUMNS;
  const cellH = sheetH / STAGE_ORDER.length;
  const alpha = extractAlpha(sheet.toBitmap(), sheetW, cellW, cellH, row);
  const box = opaqueBounds(alpha, cellW, cellH);

  const canvasH = Math.round(box.height / GLYPH_RATIO);
  const canvasW = Math.round(box.width / GLYPH_RATIO);
  const iconW = Math.round(ICON_HEIGHT * (canvasW / canvasH));
  const radius = Math.max(1, Math.round(canvasH * STROKE_RATIO));

  const mask = new Uint8Array(canvasW * canvasH);
  const offsetX = Math.round((canvasW - box.width) / 2);
  const offsetY = Math.round((canvasH - box.height) / 2);
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const a = alpha[(box.y + y) * cellW + (box.x + x)];
      mask[(offsetY + y) * canvasW + (offsetX + x)] = a > ALPHA_THRESHOLD ? 1 : 0;
    }
  }

  const empty = outline(mask, canvasW, canvasH, radius);
  const full = mask.map((on) => (on ? 255 : 0));

  const top = bellyTop(mask, canvasW, offsetY, offsetY + box.height);
  const bottom = offsetY + box.height;

  fs.mkdirSync(OUT, { recursive: true });
  for (const scale of [1, RETINA_SCALE]) {
    const suffix = scale === 1 ? '' : `-${scale}x`;
    const w = iconW * scale;
    const h = ICON_HEIGHT * scale;
    for (const [name, src] of [['empty', empty], ['full', full]]) {
      const file = path.join(OUT, `tray-${name}${suffix}.png`);
      fs.writeFileSync(file, toPng(downscaleAlpha(src, canvasW, canvasH, w, h), w, h));
    }
  }

  /**
   * 배 구간은 **비율로** 적는다. 1x 와 2x 가 같은 값을 쓰고, 나중에 아이콘 크기를 바꿔도
   * 런타임 코드를 고칠 일이 없다.
   */
  const metrics = {
    width: iconW,
    height: ICON_HEIGHT,
    bellyTop: Number((top / canvasH).toFixed(4)),
    bellyBottom: Number((bottom / canvasH).toFixed(4)),
  };
  fs.writeFileSync(path.join(OUT, 'tray-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);

  // 체형별로 굽던 시절의 파일. 남아 있으면 어느 쪽이 쓰이는지 헷갈린다.
  for (const stage of STAGE_ORDER) {
    for (const old of [`tray-${stage}.png`, `tray-${stage}@2x.png`]) {
      const file = path.join(OUT, old);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }

  const bellyPx = (metrics.bellyBottom - metrics.bellyTop) * ICON_HEIGHT;
  console.log(`  몸통 ${box.width}x${box.height} (${BODY_STAGE})  캔버스 ${canvasW}x${canvasH}  선 ${radius}px`);
  console.log(`  배 구간 ${(metrics.bellyTop * 100).toFixed(1)}% ~ ${(metrics.bellyBottom * 100).toFixed(1)}%`
    + `  → 1x 에서 ${bellyPx.toFixed(1)}px, 2x 에서 ${(bellyPx * RETINA_SCALE).toFixed(1)}px`);
  console.log(`→ ${path.relative(ROOT, OUT)}/tray-{empty,full}[-2x].png  ${iconW}x${ICON_HEIGHT}`
    + ` + ${iconW * RETINA_SCALE}x${ICON_HEIGHT * RETINA_SCALE}, tray-metrics.json`);
  app.exit(0);
});
