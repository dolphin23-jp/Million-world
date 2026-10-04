import { GUIDE_SLOTS, type GuideChip, type GuideSlot, type GuideView } from '../combat/move-guide';

/**
 * 操作ガイド（DOM。ADR-024）: 画面の下の中央に、攻撃ボタンとスティックの向きで何が出るかを、いつも同じ 5 つの枠で見せる。
 * 中身（どの枠に何が入り、どれが光るか）は src/combat/move-guide.ts（純粋関数）が決め、ここは描くだけ。
 * 毎描画フレーム呼ばれるので、変わったところだけ DOM に書く。
 */

/** 枠の見出し（入力の向きの記号と短い言葉） */
const SLOT_LABEL: Record<GuideSlot, string> = {
  tap: '● 連打',
  forward: '↑ 前',
  side: '↔ 横',
  back: '↓ 後ろ',
  hold: '◉ 長押し',
};

/** 見出しの変わりやすい版（立っているとき。「連打」ではなく単にタップ） */
const SLOT_LABEL_READY: Record<GuideSlot, string> = { ...SLOT_LABEL, tap: '● 攻撃' };

interface ChipEl {
  root: HTMLElement;
  key: HTMLElement;
  name: HTMLElement;
  note: HTMLElement;
  sig: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}

export class MoveGuide {
  private readonly head: HTMLElement;
  private readonly chipsEl: HTMLElement;
  private readonly chips = new Map<GuideSlot, ChipEl>();
  private readonly bar: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly end: HTMLElement;
  private readonly chargeEl: HTMLElement;
  private readonly chargePips: HTMLElement;
  private readonly chargeFill: HTMLElement;
  private readonly chargeText: HTMLElement;
  private headSig = '';
  private mode = '';
  private phase = '';
  private barW = -1;
  private chargeW = -1;
  private chargeSig = '';
  private visible = true;

  constructor(private readonly root: HTMLElement) {
    root.textContent = '';
    this.head = el('div', 'mg-head', root);
    this.chipsEl = el('div', 'mg-chips', root);
    for (const slot of GUIDE_SLOTS) {
      const r = el('div', `mg-chip mg-${slot}`, this.chipsEl);
      this.chips.set(slot, { root: r, key: el('i', 'mg-key', r), name: el('b', 'mg-name', r), note: el('small', 'mg-note', r), sig: '' });
    }
    this.bar = el('div', 'mg-bar', root);
    this.barFill = el('i', '', this.bar);
    this.end = el('div', 'mg-end', root);
    this.end.textContent = 'この技で連携は終わり';
    this.chargeEl = el('div', 'mg-charge', root);
    this.chargePips = el('div', 'mg-pips', this.chargeEl);
    const track = el('div', 'mg-bar mg-charge-bar', this.chargeEl);
    this.chargeFill = el('i', '', track);
    this.chargeText = el('div', 'mg-charge-text', this.chargeEl);
  }

  /** 表示の入り切り（技表の画面で切り替える） */
  setVisible(on: boolean): void {
    if (this.visible === on) return;
    this.visible = on;
    this.root.style.display = on ? '' : 'none';
  }

  update(v: GuideView): void {
    if (!this.visible) return;
    const mode = v.mode;
    if (mode !== this.mode) {
      this.mode = mode;
      this.root.dataset.mode = mode;
    }
    if (mode === 'hidden') return;
    this.updateHead(v);
    if (mode === 'charge') {
      this.updateCharge(v);
      return;
    }
    const ready = mode === 'ready';
    for (const c of v.chips) this.updateChip(c, ready);
    // 受付の帯: 待ち（白い帯が伸びる）→ 受付中（金の帯が縮む。0 で連携が切れる）。続きの無い技は「連携は終わり」
    const none = v.window.phase === 'none';
    if (v.window.phase !== this.phase) {
      this.phase = v.window.phase;
      this.root.dataset.window = this.phase;
    }
    this.root.classList.toggle('queued', v.window.queued);
    this.end.style.display = !ready && none ? '' : 'none';
    this.bar.style.display = ready || none ? 'none' : '';
    const w = Math.round(v.window.amount * 100);
    if (w !== this.barW) {
      this.barW = w;
      this.barFill.style.transform = `scaleX(${w / 100})`;
    }
  }

  private updateHead(v: GuideView): void {
    const sig = `${v.mode}|${v.title}|${v.trail.join('>')}`;
    if (sig === this.headSig) return;
    this.headSig = sig;
    this.head.textContent = '';
    if (v.mode === 'attack') {
      // 連携の履歴（古い → 新しい）。いまの技だけ大きく金色
      const trail = v.trail.length > 0 ? v.trail : [v.title];
      trail.forEach((name, i) => {
        if (i > 0) el('span', 'mg-sep', this.head).textContent = '›';
        const s = el('span', i === trail.length - 1 ? 'mg-now' : 'mg-past', this.head);
        s.textContent = name;
      });
    } else if (v.mode === 'ready' && v.title !== '') {
      el('span', 'mg-now', this.head).textContent = v.title;
    } else if (v.mode === 'charge') {
      el('span', 'mg-now', this.head).textContent = v.title;
    }
  }

  private updateChip(c: GuideChip, ready: boolean): void {
    const e = this.chips.get(c.slot)!;
    const sig = `${c.name ?? ''}|${c.selected}|${c.ready}|${c.needsLock}|${c.note ?? ''}|${ready}`;
    if (sig === e.sig) return;
    e.sig = sig;
    e.key.textContent = c.needsLock && c.name !== null ? `${SLOT_LABEL[c.slot]} 🔒` : (ready ? SLOT_LABEL_READY : SLOT_LABEL)[c.slot];
    e.name.textContent = c.name ?? '—';
    e.note.textContent = c.note ?? '';
    const cl = e.root.classList;
    cl.toggle('sel', c.selected);
    cl.toggle('rdy', c.ready && c.name !== null);
    cl.toggle('none', c.name === null);
    cl.toggle('lock', c.needsLock && c.name !== null);
  }

  private updateCharge(v: GuideView): void {
    const c = v.charge;
    if (!c) return;
    const sig = `${c.level}|${c.levels}|${c.release}|${c.max ?? ''}`;
    if (sig !== this.chargeSig) {
      this.chargeSig = sig;
      this.chargePips.textContent = '';
      for (let i = 0; i < c.levels; i++) el('i', i < c.level ? 'on' : '', this.chargePips);
      this.chargeText.textContent = '';
      el('span', 'mg-now', this.chargeText).textContent = `離す → ${c.release}`;
      if (c.max !== null) el('span', 'mg-past', this.chargeText).textContent = `最大まで溜めると ${c.max}`;
    }
    const w = Math.round(c.progress * 100);
    if (w !== this.chargeW) {
      this.chargeW = w;
      this.chargeFill.style.transform = `scaleX(${w / 100})`;
    }
  }
}
