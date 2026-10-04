import { h, onPress } from '../dom';
import type { MenuTab } from '../pause-menu';

/**
 * メニューのタブ「設定」（ADR-033）: 表示の設定（操作ガイドの入り切り）と、データ（「最初から」= セーブの消去）。
 * 設定が増えたら、ここに行を足す（音量・操作の感度・カメラなど）。ストレージが使えないときは覚えないだけ（ゲームは動く）。
 */

const GUIDE_KEY = 'mw.guide';

export interface SettingsTabDeps {
  /** 操作ガイドの表示が変わったとき・最初の状態を受け取る */
  onGuideVisible: (on: boolean) => void;
  /** 「最初から」（成長とセーブを消す）。二度押しで呼ばれる */
  onResetProgress: () => void;
}

export class SettingsTab implements MenuTab {
  readonly id = 'settings';
  readonly label = '設定';
  private guide!: HTMLInputElement;
  private resetBtn!: HTMLButtonElement;
  private resetTimer = 0;

  constructor(private readonly d: SettingsTabDeps) {}

  build(root: HTMLElement): void {
    root.appendChild(h('div', 'set-title', '表示'));
    const guideRow = h('label', 'set-row');
    this.guide = h('input');
    this.guide.type = 'checkbox';
    this.guide.checked = this.loadGuide();
    guideRow.append(this.guide, h('span', undefined, '画面の下に操作ガイドを出す'));
    this.guide.addEventListener('change', () => {
      this.saveGuide(this.guide.checked);
      this.d.onGuideVisible(this.guide.checked);
    });
    root.appendChild(guideRow);
    this.d.onGuideVisible(this.guide.checked);

    root.appendChild(h('div', 'set-title', 'データ'));
    const dataRow = h('div', 'set-row col');
    dataRow.appendChild(h('span', 'set-note', 'レベル・経験値・振り分けを消して、最初からやり直す（元に戻せない）'));
    this.resetBtn = h('button', 'menu-btn danger', '最初から（セーブを消す）');
    this.resetBtn.type = 'button';
    onPress(
      this.resetBtn,
      () => {
        if (this.resetBtn.dataset.armed === '1') {
          this.disarm();
          this.d.onResetProgress();
        } else {
          this.resetBtn.dataset.armed = '1';
          this.resetBtn.textContent = '本当に消す？ もう一度押すと消えます';
          window.clearTimeout(this.resetTimer);
          this.resetTimer = window.setTimeout(() => this.disarm(), 3500);
        }
        return false;
      },
      { repeat: false },
    );
    dataRow.appendChild(this.resetBtn);
    root.appendChild(dataRow);
  }

  private disarm(): void {
    window.clearTimeout(this.resetTimer);
    this.resetBtn.dataset.armed = '0';
    this.resetBtn.textContent = '最初から（セーブを消す）';
  }

  refresh(): void {
    this.disarm();
  }

  private loadGuide(): boolean {
    try {
      return localStorage.getItem(GUIDE_KEY) !== '0';
    } catch {
      return true; // プライベートブラウズなどで localStorage が使えないときは既定（表示）
    }
  }

  private saveGuide(on: boolean): void {
    try {
      localStorage.setItem(GUIDE_KEY, on ? '1' : '0');
    } catch {
      /* 保存できなくても動く */
    }
  }
}
