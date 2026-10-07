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
 * 셀 크기(1x 기준).
 *
 * **높이와 폭의 제약이 다르다.**
 * 높이는 창 배치가 묶는다 — 캐릭터는 터미널 창 위에 앉는데(FR-02) 메뉴바 바로 아래
 * 있는 창은 공간이 없어 클램프되고, 셀이 94px 를 넘으면 캐릭터가 창 안으로 파고든다.
 * 폭은 그런 제약이 없다. 캐릭터는 셀 가운데에 그려지므로 폭을 늘려도 화면상 위치가
 * 변하지 않고, 남는 좌우는 투명하다. 그래서 누운 자세(기절)처럼 가로로 긴 포즈를
 * 위해 폭만 넉넉히 준다.
 */
const CELL = { width: 104, height: 92 };
/**
 * 셀 안에서 캐릭터가 차지할 최대 높이. 위쪽 여백은 통통 튀는 모션(-4px)이 쓴다.
 *
 * 셀 높이의 상한은 창 위치가 정한다. 캐릭터는 터미널 창 **위에** 앉는데(FR-02),
 * 메뉴바 바로 아래 있는 창(y≈70)은 그만한 공간이 없어 화면 상단으로 클램프된다.
 * 셀이 94px 를 넘으면 그때 캐릭터가 창 안으로 20px 넘게 파고든다 (diag 로 실측).
 */
const CHAR_HEIGHT = 80;
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
 *   slim-grid.png → 한 장에 여러 포즈가 격자로 들어 있다. 잘라서 쓴다
 */
function parseName(file) {
  const base = path.basename(file, path.extname(file));
  const match = base.match(/^([a-z]+)(?:-(grid|\d+))?$/);
  if (!match || !STAGE_ORDER.includes(match[1])) return null;
  if (match[2] === 'grid') return { stage: match[1], grid: true };
  return { stage: match[1], frame: match[2] ? Number(match[2]) - 1 : 0 };
}

/**
 * 여러 포즈가 격자로 들어 있는 한 장을 프레임별 사각형으로 쪼갠다.
 *
 * 생성 AI 에게 프레임을 한 장씩 요청하면 너무 느리다. 격자로 한 번에 받되
 * **셀 크기를 모델에게 맡기지 않는 것**이 요점이다 — 빈 공간을 찾아 우리가 자른다.
 * 자른 뒤에는 각 프레임을 발끝 기준으로 다시 정렬하므로 격자가 삐뚤어도 상관없다.
 *
 * 칸은 **2차원 연결 덩어리**로 센다. 행·열 히스토그램으로 자르던 방식은 트림 모션에서
 * 무너졌다 — 입에서 나온 구름이 옆 칸 캐릭터와 **닿지 않는데도 x 범위가 겹쳐서**
 * 한 칸으로 잡혔다(실측: 2x3 격자가 chubby 4칸 / fat·slim 5칸). 투영이 아니라
 * 실제로 이어진 픽셀을 세면 떨어져 있는 그림은 언제나 갈라진다.
 *
 * 읽는 순서는 왼쪽→오른쪽, 위→아래다.
 */
function segment(bitmap, width, height) {
  const label = new Int32Array(width * height).fill(-1);
  const boxes = [];
  const stack = [];

  for (let seed = 0; seed < width * height; seed++) {
    if (label[seed] >= 0 || bitmap[seed * 4 + 3] < 16) continue;

    const id = boxes.length;
    const box = { x: seed % width, y: (seed / width) | 0, width: 1, height: 1, area: 0, ids: [id] };
    let minX = box.x;
    let maxX = box.x;
    let minY = box.y;
    let maxY = box.y;

    label[seed] = id;
    stack.push(seed);
    while (stack.length) {
      const i = stack.pop();
      const x = i % width;
      const y = (i / width) | 0;
      box.area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      // 8방향. 4방향으로만 이으면 대각선으로 이어진 가는 선(구름 꼬리)이 끊긴다.
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const n = ny * width + nx;
          if (label[n] >= 0 || bitmap[n * 4 + 3] < 16) continue;
          label[n] = id;
          stack.push(n);
        }
      }
    }

    box.x = minX;
    box.y = minY;
    box.width = maxX - minX + 1;
    box.height = maxY - minY + 1;
    boxes.push(box);
  }

  if (!boxes.length) return { cells: boxes, label };

  /*
   * 큰 덩어리만 칸으로 친다. 나머지는 **가장 가까운 칸에 붙인다** —
   * 입에서 떨어져 나온 연기나 반짝임은 캐릭터와 이어져 있지 않지만 같은 프레임의 일부다.
   * 압축 잡티도 여기서 흡수되므로 따로 거를 필요가 없다.
   *
   * 기준이 중앙값이 아니라 **최댓값**인 이유: 한 칸에서 떨어져 나오는 조각이 수십 개라
   * (기절 모션의 파리처럼) 중앙값이 잡티 쪽으로 쏠린다. 실측으로 155덩어리짜리 격자에서
   * 중앙값 기준은 16칸을 내놨다. 한 격자 안의 캐릭터는 크기가 비슷하므로 최댓값이 안정적이다.
   */
  const largest = Math.max(...boxes.map((b) => b.area));
  const cells = boxes.filter((b) => b.area >= largest * 0.3);

  for (const piece of boxes) {
    if (cells.includes(piece)) continue;
    let best = null;
    let bestDistance = Infinity;
    for (const cell of cells) {
      const dx = Math.max(0, cell.x - (piece.x + piece.width), piece.x - (cell.x + cell.width));
      const dy = Math.max(0, cell.y - (piece.y + piece.height), piece.y - (cell.y + cell.height));
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = cell;
      }
    }
    const right = Math.max(best.x + best.width, piece.x + piece.width);
    const bottom = Math.max(best.y + best.height, piece.y + piece.height);
    best.x = Math.min(best.x, piece.x);
    best.y = Math.min(best.y, piece.y);
    best.width = right - best.x;
    best.height = bottom - best.y;
    best.ids.push(...piece.ids);
  }

  // 읽는 순서로 되돌린다. 행이 삐뚤 수 있어 y 중심을 칸 높이 절반 안에서 묶는다.
  const heights = cells.map((b) => b.height).sort((a, b) => a - b);
  const tolerance = heights[Math.floor(heights.length / 2)] / 2;
  const rows = [];
  for (const cell of [...cells].sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2))) {
    const center = cell.y + cell.height / 2;
    const row = rows[rows.length - 1];
    if (row && center - row.center <= tolerance) row.cells.push(cell);
    else rows.push({ center, cells: [cell] });
  }
  return { cells: rows.flatMap((row) => row.cells.sort((a, b) => a.x - b.x)), label };
}

/**
 * 격자에서 잘라낸 한 칸을 독립된 이미지 버퍼로 뽑는다.
 *
 * 칸은 사각형이라 **이웃 칸과 겹칠 수 있다** — 트림 구름이 옆 칸 영역까지 뻗으면
 * 옆 칸을 자를 때 그 조각이 같이 딸려 온다(실측: 4·5번 프레임 가장자리에 구름 부스러기).
 * 그래서 이 칸에 속한 덩어리가 아닌 픽셀은 지우고 가져온다.
 */
function cropBitmap(src, srcW, box, label) {
  const mine = new Set(box.ids);
  const out = Buffer.alloc(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) {
    const from = ((box.y + y) * srcW + box.x) * 4;
    src.copy(out, y * box.width * 4, from, from + box.width * 4);
    for (let x = 0; x < box.width; x++) {
      if (mine.has(label[(box.y + y) * srcW + box.x + x])) continue;
      out.fill(0, (y * box.width + x) * 4, (y * box.width + x) * 4 + 4);
    }
  }
  return out;
}

/** 체형별로 파일을 모은다. { slim: { frames: [파일…], grid: 파일|null } } */
function loadFrames(dir) {
  const byStage = new Map();
  const skipped = [];

  for (const name of fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png'))) {
    const parsed = parseName(name);
    if (!parsed) {
      skipped.push(name);
      continue;
    }
    if (!byStage.has(parsed.stage)) byStage.set(parsed.stage, { frames: [], grid: null });
    const entry = byStage.get(parsed.stage);
    if (parsed.grid) entry.grid = path.join(dir, name);
    else entry.frames[parsed.frame] = path.join(dir, name);
  }

  if (skipped.length) {
    console.error(`  이름 규칙(<체형>[-<번호>|-grid].png)에 안 맞아 건너뛴다: ${skipped.join(', ')}`);
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

  const scaleOf = (f) => (charH * ((f.box.height / f.height) / tallest)) / f.box.height;

  /*
   * 높이만 맞추면 **가로로 긴 포즈가 셀 밖으로 나간다** — 기절처럼 누운 그림이 그렇다.
   * 가장 넓어지는 프레임이 셀을 넘으면 그룹 전체를 같은 비율로 줄인다.
   * 프레임마다 따로 줄이면 체형 간 크기 차이가 사라지므로 **공통 배율**이어야 한다.
   */
  const maxCharW = (CELL.width - 6) * SCALE;
  let shrink = 1;
  for (const frame of all) {
    const projected = frame.box.width * scaleOf(frame);
    if (projected > maxCharW) shrink = Math.min(shrink, maxCharW / projected);
  }
  if (shrink < 1) {
    console.log(`  가로가 셀을 넘어 전체를 ${(shrink * 100).toFixed(0)}% 로 줄였다`);
  }

  /*
   * 최종 캐릭터 크기를 1x 기준으로 알린다.
   * 누운 포즈는 폭에 막혀 그룹 전체가 줄어들기 때문에, 서 있는 모션보다 몸이 작아진다.
   * 셀 폭을 얼마나 줘야 하는지는 이 숫자를 보고 정한다.
   */
  const footprint = all.reduce((acc, f) => {
    const scale = scaleOf(f) * shrink;
    return {
      width: Math.max(acc.width, f.box.width * scale / SCALE),
      height: Math.max(acc.height, f.box.height * scale / SCALE),
    };
  }, { width: 0, height: 0 });
  console.log(`  캐릭터 최대 ${footprint.width.toFixed(0)}x${footprint.height.toFixed(0)}px`
    + ` (셀 ${CELL.width}x${CELL.height}, 목표 높이 ${CHAR_HEIGHT})`);

  const sheetW = cellW * columns;
  const sheetH = cellH * STAGE_ORDER.length;
  const sheet = Buffer.alloc(sheetW * sheetH * 4);
  const filled = [];

  STAGE_ORDER.forEach((stage, row) => {
    let frames = byStage.get(stage);
    if (!frames?.length) {
      // 기절처럼 한 체형만 만든 모션은 slim 자체가 없다. 있는 것 중 첫 번째로 메운다.
      frames = byStage.get('slim') ?? [...byStage.values()][0];
      filled.push(stage);
    }
    if (!frames?.length) return;

    for (let column = 0; column < columns; column++) {
      // 프레임 수가 모자라면 마지막 프레임을 늘려 쓴다. 중간이 비면 재생이 끊긴다.
      const frame = frames[column] ?? frames[frames.length - 1];
      const scale = scaleOf(frame) * shrink;

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

    for (const [stage, entry] of loadFrames(path.join(RAW, group))) {
      const prepared = [];
      let source = '낱장';

      if (entry.grid) {
        // 격자 한 장에서 포즈를 잘라낸다. 잘라낸 칸이 그대로 한 프레임이 된다.
        const sheet = prepare(entry.grid);
        const { cells, label } = segment(sheet.bitmap, sheet.width, sheet.height);
        source = `격자 ${cells.length}칸`;
        for (const box of cells) {
          const bitmap = cropBitmap(sheet.bitmap, sheet.width, box, label);
          prepared.push({
            file: entry.grid,
            width: box.width,
            height: box.height,
            bitmap,
            box: opaqueBounds(bitmap, box.width, box.height),
            cleared: sheet.cleared,
          });
        }
      }

      for (const file of entry.frames) {
        if (!file) continue;
        const frame = prepare(file);
        if (!frame.box) {
          console.error(`  ${path.basename(file)} 캐릭터를 못 찾았다. 건너뛴다`);
          continue;
        }
        prepared.push(frame);
      }

      const usable = prepared.filter((f) => f.box);
      if (usable.length) byStage.set(stage, usable);
      console.log(`  ${stage.padEnd(7)} ${String(usable.length).padStart(2)} 프레임 (${source})`
        + `  배경 제거 ${(usable.reduce((a, f) => a + f.cleared, 0) / Math.max(1, usable.length) * 100).toFixed(0)}%`);
    }

    if (!byStage.size) continue;
    const result = buildSheet(group, byStage);
    console.log(`  → ${path.relative(ROOT, result.file)}  ${result.width}x${result.height}`
      + `  (${STAGE_ORDER.length}행 x ${result.columns}열)`);
  }
  app.exit(0);
});
