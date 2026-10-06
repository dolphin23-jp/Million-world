/**
 * 杖の魔法ボタン（DOM。ADR-048）。アイテム欄・スキル欄（SlotButton = 1 つのボタンに一覧が開く）と違い、**全部の魔法を画面に並列に並べる**
 * （押したものをそのまま詠唱する。選択を介さない）。入力層はロジックを知らない（touch.ts と同じ約束）: 何を出すか（setSpells）・
 * クールダウンの表示（setCooldown）は Game が教え、押したら onPress(番号) で知らせる。
 * 置き場所は src/style.css の #spell-grid（実機で決める。そこの right / bottom / 列数だけを触る）。
 */

export interface SpellButtonOption {
  /** ボタンに出す短い表記（4 文字まで）と、色（CSS。宝珠の色） */
  label: string;
  color: string;
  /** 角の小さな丸の文字（「Lv3」など。無ければ出さない） */
  badge?: string;
  /** キーボードの番号（左から 1, 2, …。ボタンの隅に小さく出す） */
  key?: string;
}

function div(cls: string, text?: string): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

interface Cell {
  root: HTMLElement;
  orb: HTMLElement;
  label: HTMLElement;
  badge: HTMLElement;
  key: HTMLElement;
  cd: HTMLElement;
  cdNum: HTMLElement;
  /** 最後に書いた使い直しの待ち（毎フレームの無駄な書き込みを避ける） */
  lastCd: string;
}

export class SpellButtons {
  private readonly cells: Cell[] = [];
  /** 押した（ボタンの番号） */
  onPress: ((index: number) => void) | null = null;

  constructor(private readonly el: HTMLElement) {}

  /** 並べる魔法を設定する（数が変わったときだけ作り直す。同じ数なら中身だけ更新する） */
  setSpells(list: readonly SpellButtonOption[]): void {
    while (this.cells.length < list.length) this.addCell();
    while (this.cells.length > list.length) this.cells.pop()!.root.remove();
    list.forEach((o, i) => {
      const c = this.cells[i]!;
      c.root.style.setProperty('--c', o.color);
      if (c.label.textContent !== o.label) c.label.textContent = o.label;
      const badge = o.badge ?? '';
      if (c.badge.textContent !== badge) c.badge.textContent = badge;
      const key = o.key ?? '';
      if (c.key.textContent !== key) c.key.textContent = key;
    });
  }

  /**
   * クールダウンの表示: ratio = 残りの割合（1 = 使った直後、0 = 使える）、seconds = 残りの秒（表示は 1 桁まで）。
   * 暗い扇が時計回りに消えていき、真ん中に残りの秒が出る。使えるときは宝珠が明るい
   */
  setCooldown(index: number, ratio: number, seconds: number): void {
    const c = this.cells[index];
    if (!c) return;
    const cooling = ratio > 0;
    const key = cooling ? `${Math.round(ratio * 360)}:${seconds >= 10 ? Math.ceil(seconds) : seconds.toFixed(1)}` : '';
    if (key === c.lastCd) return;
    c.lastCd = key;
    c.root.classList.toggle('cooling', cooling);
    c.cd.style.setProperty('--cd', `${Math.round(ratio * 360)}deg`);
    c.cdNum.textContent = cooling ? (seconds >= 10 ? String(Math.ceil(seconds)) : seconds.toFixed(1)) : '';
  }

  /** 押している見た目だけ（入力そのものは bindButton が受ける） */
  private addCell(): void {
    const index = this.cells.length;
    const root = div('tbtn spell-btn');
    const orb = div('spell-orb');
    const label = div('spell-label');
    const badge = div('spell-lv');
    const key = div('spell-key');
    const cd = div('spell-cd');
    const cdNum = div('spell-cd-num');
    root.append(cd, orb, label, badge, key, cdNum);
    this.el.appendChild(root);
    const cell: Cell = { root, orb, label, badge, key, cd, cdNum, lastCd: '' };
    this.cells.push(cell);
    // 押したら即座に詠唱を頼む（離しても何も起きない。touch.ts の bindButton と同じ約束で pointerId を追う）
    let pid: number | null = null;
    root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (pid !== null) return;
      pid = e.pointerId;
      root.setPointerCapture(e.pointerId);
      root.classList.add('pressed');
      this.onPress?.(index);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== pid) return;
      pid = null;
      root.classList.remove('pressed');
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('lostpointercapture', end);
  }
}
