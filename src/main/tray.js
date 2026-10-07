import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Menu, Tray, nativeImage } from 'electron';
import { LIMIT_MODES, QUIT_SHORTCUT } from './config.js';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');

/** `build-tray.mjs` 가 굽는 배율. 파일 이름의 접미사이자 nativeImage 의 scaleFactor 다. */
const SCALES = [1, 2];

const MODE_LABELS = { '5h': '5시간 한도', weekly: '주간 한도' };

/**
 * 재료 두 장을 읽어 알파만 남긴다. 템플릿 아이콘이라 색은 쓰지 않는다.
 *
 * 파일명에 `@2x` 대신 `-2x` 를 쓰는 이유는 **Electron 이 `@2x` 를 HiDPI 표현으로 보고
 * 1x 파일에 합쳐 버리기 때문이다** — 그러면 `toBitmap()` 과 `getSize()` 가 어긋나
 * 합성이 깨진다. 여기서는 두 배율을 따로 들고 있어야 한다.
 */
function loadLayer(name, scale) {
  const suffix = scale === 1 ? '' : `-${scale}x`;
  const image = nativeImage.createFromPath(path.join(ASSETS, `tray-${name}${suffix}.png`));
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = bitmap[i * 4 + 3];
  return { alpha, width, height };
}

/**
 * 메뉴바 트레이 (Phase 5).
 *
 * Dock 아이콘도 창도 없는 앱이라 **사용자가 설정을 건드릴 입구가 여기뿐이다.**
 * 한도 모드 전환(FR-10)과 종료를 맡는다.
 *
 * 아이콘은 **사용률만큼 차오르는 게이지**다. 빈 몸통과 꽉 찬 몸통을 미리 구워 두고
 * (`npm run build:tray`) 사용률 높이에서 잘라 붙인다. 체형 4단계로 끊지 않는 이유는
 * 14px 폭에서 실루엣 차이가 읽히지 않아서다 — 경계 줄은 두 장의 알파를 섞어
 * 픽셀 사이 값까지 표현한다.
 *
 * 모드 전환은 **직접 처리하지 않고 `limit-mode` 이벤트로 올린다** — 저장과
 * `UsageMonitor` 반영은 `index.js` 가 한다. 트레이가 두 곳을 다 알면 테스트가 Electron 에
 * 묶인다.
 */
export class TrayController extends EventEmitter {
  #tray = null;
  #limitMode;
  #metrics;
  /** 배율별 { empty, full } 알파 레이어. */
  #layers = new Map();
  /** 마지막으로 그린 채움 비율. 같은 값이면 다시 합성하지 않는다. */
  #level = null;
  /** 메뉴 라벨에 쓸 최근 사용률. 데이터가 오기 전에는 null 이다. */
  #usedPercentage = null;

  constructor(limitMode) {
    super();
    this.#limitMode = LIMIT_MODES.includes(limitMode) ? limitMode : LIMIT_MODES[0];
  }

  create() {
    this.#metrics = JSON.parse(fs.readFileSync(path.join(ASSETS, 'tray-metrics.json'), 'utf8'));
    for (const scale of SCALES) {
      this.#layers.set(scale, { empty: loadLayer('empty', scale), full: loadLayer('full', scale) });
    }

    this.#tray = new Tray(this.#compose(0));
    this.#level = 0;
    this.#render();
  }

  /**
   * `UsageMonitor` 의 snapshot 을 그대로 넘기면 된다.
   * 데이터가 없는 동안에도 아이콘은 떠 있어야 하므로 사용률이 없으면 빈 몸으로 둔다.
   */
  setUsage({ usedPercentage }) {
    const level = Math.min(1, Math.max(0, (usedPercentage ?? 0) / 100));
    // 1/255 보다 작은 차이는 알파 한 칸도 못 움직인다. 합성을 건너뛴다.
    if (this.#level === null || Math.abs(level - this.#level) >= 1 / 255) {
      this.#level = level;
      this.#tray?.setImage(this.#compose(level));
    }
    this.#usedPercentage = usedPercentage ?? null;
    this.#render();
  }

  setLimitMode(mode) {
    if (!LIMIT_MODES.includes(mode) || mode === this.#limitMode) return;
    this.#limitMode = mode;
    this.#render();
  }

  destroy() {
    this.#tray?.destroy();
    this.#tray = null;
  }

  /**
   * 배 아래쪽을 `level` 만큼 꽉 찬 쪽으로 바꾼 아이콘.
   *
   * 경계가 걸친 줄은 두 레이어를 그 비율로 섞는다. 배 구간이 1x 에서 12px 뿐이라
   * 줄 단위로만 끊으면 12단계밖에 안 나온다.
   *
   * 템플릿 이미지로 올려야 macOS 가 다크 모드에서 흰색으로, 메뉴를 펼친 동안 또 다르게
   * 자동 반전해 준다. 끄면 다크 모드에서 검은 배경에 묻힌다.
   */
  #compose(level) {
    const icon = nativeImage.createEmpty();

    for (const scale of SCALES) {
      const { empty, full } = this.#layers.get(scale);
      const { width, height } = empty;
      const top = this.#metrics.bellyTop * height;
      const bottom = this.#metrics.bellyBottom * height;
      const fillTop = bottom - (bottom - top) * level;

      const bgra = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y++) {
        const coverage = Math.min(1, Math.max(0, (y + 1) - fillTop));
        if (coverage === 0) {
          for (let x = 0; x < width; x++) bgra[(y * width + x) * 4 + 3] = empty.alpha[y * width + x];
          continue;
        }
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          const a = empty.alpha[i] + (full.alpha[i] - empty.alpha[i]) * coverage;
          bgra[i * 4 + 3] = Math.round(a);
        }
      }

      icon.addRepresentation({
        scaleFactor: scale,
        width,
        height,
        buffer: nativeImage.createFromBitmap(bgra, { width, height }).toPNG(),
      });
    }

    icon.setTemplateImage(true);
    return icon;
  }

  #render() {
    if (!this.#tray) return;

    const percent = this.#usedPercentage === null
      ? '사용량 대기 중'
      : `${this.#usedPercentage.toFixed(0)}% 사용`;
    this.#tray.setToolTip(`먹보 — ${percent} (${MODE_LABELS[this.#limitMode]})`);

    this.#tray.setContextMenu(Menu.buildFromTemplate([
      { label: percent, enabled: false },
      { type: 'separator' },
      ...LIMIT_MODES.map((mode) => ({
        label: MODE_LABELS[mode],
        type: 'radio',
        checked: mode === this.#limitMode,
        // radio 를 누르면 Electron 이 체크를 먼저 옮긴다. 거절할 일이 없으니 그대로 올린다.
        click: () => this.emit('limit-mode', mode),
      })),
      { type: 'separator' },
      { label: '종료', accelerator: QUIT_SHORTCUT, role: 'quit' },
    ]));
  }
}
