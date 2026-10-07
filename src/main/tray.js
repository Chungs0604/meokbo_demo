import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Menu, Tray, nativeImage } from 'electron';
import { FATNESS_STAGES, LIMIT_MODES, QUIT_SHORTCUT } from './config.js';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');

/** 사용량 데이터가 오기 전에 띄울 아이콘. 비어 있는 몸이 "아직 모름"에 가깝다. */
const FALLBACK_STAGE = FATNESS_STAGES[0].stage;

const MODE_LABELS = { '5h': '5시간 한도', weekly: '주간 한도' };

/**
 * 메뉴바 트레이 (Phase 5).
 *
 * Dock 아이콘도 창도 없는 앱이라 **사용자가 설정을 건드릴 입구가 여기뿐이다.**
 * 한도 모드 전환(FR-10)과 종료를 맡는다.
 *
 * 아이콘은 체형 4단계가 따로 있어서 사용률이 오르면 메뉴바에서도 몸이 차오른다
 * (`npm run build:tray` 가 `body.png` 에서 굽는다).
 *
 * 모드 전환은 **직접 처리하지 않고 `limit-mode` 이벤트로 올린다** — 저장과
 * `UsageMonitor` 반영은 `index.js` 가 한다. 트레이가 두 곳을 다 알면 테스트가 Electron 에
 * 묶인다.
 */
export class TrayController extends EventEmitter {
  #tray = null;
  #limitMode;
  #stage = null;
  /** 메뉴 라벨에 쓸 최근 사용률. 데이터가 오기 전에는 null 이다. */
  #usedPercentage = null;

  constructor(limitMode) {
    super();
    this.#limitMode = LIMIT_MODES.includes(limitMode) ? limitMode : LIMIT_MODES[0];
  }

  create() {
    this.#tray = new Tray(this.#icon(FALLBACK_STAGE));
    this.#stage = FALLBACK_STAGE;
    this.#render();
  }

  /**
   * `UsageMonitor` 의 snapshot 을 그대로 넘기면 된다.
   * 데이터가 없는 동안에도 아이콘은 떠 있어야 하므로 stage 가 null 이면 기본 단계를 쓴다.
   */
  setUsage({ stage, usedPercentage }) {
    const next = stage ?? FALLBACK_STAGE;
    if (next !== this.#stage) {
      this.#stage = next;
      this.#tray?.setImage(this.#icon(next));
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
   * 템플릿 이미지로 올려야 macOS 가 다크 모드에서 흰색으로, 메뉴를 펼친 동안 또 다르게
   * 자동 반전해 준다. 끄면 다크 모드에서 검은 배경에 묻힌다.
   * `@2x` 는 파일명 규약으로 Electron 이 알아서 찾는다.
   */
  #icon(stage) {
    const image = nativeImage.createFromPath(path.join(ASSETS, `tray-${stage}.png`));
    image.setTemplateImage(true);
    return image;
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
