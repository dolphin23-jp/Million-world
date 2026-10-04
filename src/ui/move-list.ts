import type { MoveNode } from '../combat/move-tree';

/**
 * 技表（DOM。ADR-024）: 装備の技の一覧。始動の技と、そこから続けられる技を木で見せる。右上の「技表」ボタンで開き、開いているあいだは戦闘を止める。
 * 中身は src/combat/move-tree.ts（純粋関数）が作る。操作ガイド（下の帯）の表示の入り切りもここで持つ。
 */

const STORAGE_KEY = 'mw.guide';

export class MoveList {
  private readonly overlay: HTMLElement;
  private readonly body: HTMLElement;
  private readonly title: HTMLElement;
  private readonly toggle: HTMLInputElement;
  private openCb: ((open: boolean) => void) | null = null;
  private guideCb: ((on: boolean) => void) | null = null;

  constructor() {
    this.overlay = document.getElementById('moves-overlay')!;
    this.body = this.overlay.querySelector('.ml-body') as HTMLElement;
    this.title = this.overlay.querySelector('.ml-title') as HTMLElement;
    this.toggle = this.overlay.querySelector('.ml-guide input') as HTMLInputElement;
    const btn = document.getElementById('btn-moves')!;
    // pointerdown で受ける（ボタンと同じ。iOS のタップは click より早く確実）
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setOpen(this.overlay.classList.contains('hidden'));
    });
    this.overlay.querySelector('.ml-close')!.addEventListener('pointerdown', (e) => {
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
      if (e.code === 'KeyM') this.setOpen(this.overlay.classList.contains('hidden'));
      else if (e.code === 'Escape') this.setOpen(false);
    });
    this.toggle.addEventListener('change', () => {
      this.save(this.toggle.checked);
      this.guideCb?.(this.toggle.checked);
    });
    this.toggle.checked = this.load();
  }

  /** 操作ガイドの表示が変わったとき・最初の状態を受け取る */
  onGuideVisible(cb: (on: boolean) => void): void {
    this.guideCb = cb;
    cb(this.toggle.checked);
  }

  /** 技表を開閉したとき（戦闘を止める・再開する）に呼ぶもの */
  onOpen(cb: (open: boolean) => void): void {
    this.openCb = cb;
  }

  get isOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  setOpen(open: boolean): void {
    if (open === this.isOpen) return;
    this.overlay.classList.toggle('hidden', !open);
    this.openCb?.(open);
  }

  /** 装備の技表を作り直す（装備を替えたとき） */
  setMoves(loadoutName: string, nodes: readonly MoveNode[]): void {
    this.title.textContent = `${loadoutName} の技`;
    this.body.textContent = '';
    for (const n of nodes) this.body.appendChild(this.row(n, 0));
  }

  private row(n: MoveNode, depth: number): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'ml-node';
    const line = document.createElement('div');
    line.className = `ml-line d${Math.min(depth, 5)}`;
    const input = document.createElement('span');
    input.className = 'ml-input';
    input.textContent = n.input + (n.needsLock ? '（ロック中）' : '');
    const name = document.createElement('b');
    name.className = 'ml-name';
    name.textContent = n.name;
    line.append(input, name);
    if (n.note) {
      const note = document.createElement('small');
      note.textContent = n.note;
      line.appendChild(note);
    }
    wrap.appendChild(line);
    for (const c of n.children) wrap.appendChild(this.row(c, depth + 1));
    return wrap;
  }

  private load(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) !== '0';
    } catch {
      return true; // プライベートブラウズなどで localStorage が使えないときは既定（表示）
    }
  }

  private save(on: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      /* 保存できなくても動く */
    }
  }
}
