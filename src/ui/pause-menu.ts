import { h } from './dom';

/**
 * 一時停止メニュー（DOM。ADR-033）。右上の「メニュー」ボタン・Escape / M キーで開き、開いているあいだは戦闘を止める。
 * ステータス振り・スキルポイント・技表・設定などの画面を**タブ**として持つ。機能が増えるたびに addTab で足していけるようにしてある
 * （装備・持ち物・図鑑など。タブは MenuTab を満たすオブジェクトで、メニュー本体は中身を知らない）。
 */

export interface MenuTab {
  id: string;
  /** タブに書く名前 */
  label: string;
  /** タブの印（未使用のポイントがある、など）。true なら金色の点が付く。省略 = 印なし */
  mark?: () => boolean;
  /** 中身の入れ物 root に、静的な構造を一度だけ作る */
  build(root: HTMLElement): void;
  /** 開いたとき・値が変わったときに、中身を合わせる（作り直さず、変わったところだけ書き換える） */
  refresh(): void;
}

interface TabEntry {
  tab: MenuTab;
  button: HTMLElement;
  dot: HTMLElement;
  pane: HTMLElement;
}

export class PauseMenu {
  private readonly overlay: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly menuBtn: HTMLElement;
  private readonly menuDot: HTMLElement;
  private readonly entries: TabEntry[] = [];
  private current = '';
  private openCb: ((open: boolean) => void) | null = null;

  constructor() {
    this.overlay = document.getElementById('menu-overlay')!;
    this.tabsEl = this.overlay.querySelector('.menu-tabs') as HTMLElement;
    this.bodyEl = this.overlay.querySelector('.menu-body') as HTMLElement;
    this.menuBtn = document.getElementById('btn-menu')!;
    this.menuDot = h('span', 'menu-dot');
    this.menuBtn.appendChild(this.menuDot);
    // pointerdown で受ける（ボタンと同じ。iOS のタップは click より早く確実）
    this.menuBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    });
    this.overlay.querySelector('.menu-close')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.setOpen(false);
    });
    // 暗い背景のタップでも閉じる（カードの中は閉じない）
    this.overlay.addEventListener('pointerdown', (e) => {
      if (e.target === this.overlay) {
        e.preventDefault();
        this.setOpen(false);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyM' || e.code === 'Escape') {
        if (e.code === 'Escape' && !this.isOpen) return; // Escape は閉じるだけ（開くのは M とボタン）
        this.toggle();
      }
    });
  }

  /** タブを足す（表示の順 = 足した順）。最初に足したタブが最初に開く */
  addTab(tab: MenuTab): void {
    const button = h('button', 'menu-tab');
    button.type = 'button';
    button.append(h('span', 'menu-tab-label', tab.label));
    const dot = h('span', 'menu-dot');
    button.appendChild(dot);
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.select(tab.id);
    });
    const pane = h('div', 'menu-pane');
    pane.dataset.tab = tab.id;
    tab.build(pane);
    this.tabsEl.appendChild(button);
    this.bodyEl.appendChild(pane);
    this.entries.push({ tab, button, dot, pane });
    if (this.current === '') this.select(tab.id);
    else this.syncActive();
  }

  /** 開閉したとき（戦闘を止める・再開する）に呼ぶもの */
  onOpen(cb: (open: boolean) => void): void {
    this.openCb = cb;
  }

  get isOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  toggle(): void {
    this.setOpen(!this.isOpen);
  }

  setOpen(open: boolean): void {
    if (open === this.isOpen) return;
    this.overlay.classList.toggle('hidden', !open);
    if (open) this.refresh();
    this.openCb?.(open);
  }

  /** タブを選ぶ */
  select(id: string): void {
    if (!this.entries.some((e) => e.tab.id === id)) return;
    this.current = id;
    this.bodyEl.scrollTop = 0;
    this.syncActive();
    this.refresh();
  }

  get currentTab(): string {
    return this.current;
  }

  /** いま開いているタブの中身と、印（タブ・メニューボタンの点）を合わせる。値が変わるたびに呼んでよい */
  refresh(): void {
    let any = false;
    for (const e of this.entries) {
      const on = e.tab.mark?.() ?? false;
      e.dot.classList.toggle('on', on);
      any = any || on;
      if (e.tab.id === this.current) e.tab.refresh();
    }
    this.menuDot.classList.toggle('on', any);
  }

  /** 印だけを合わせる（メニューを開いていないあいだ、レベルアップでポイントが増えたとき）。中身は触らない */
  refreshMarks(): void {
    let any = false;
    for (const e of this.entries) {
      const on = e.tab.mark?.() ?? false;
      e.dot.classList.toggle('on', on);
      any = any || on;
    }
    this.menuDot.classList.toggle('on', any);
  }

  private syncActive(): void {
    for (const e of this.entries) {
      const on = e.tab.id === this.current;
      e.button.classList.toggle('active', on);
      e.pane.classList.toggle('active', on);
    }
  }
}
