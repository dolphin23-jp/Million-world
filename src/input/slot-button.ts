import { DEFAULT_SLOT_GESTURE, SlotGesture, type SlotEvent, type SlotGestureConfig } from './slot-gesture';

/**
 * スロットボタン（DOM。ADR-030）。アイテム欄・将来のスキル欄が使い回す部品。
 * ボタンには「いま選んでいるもの」を出し、タップでそれを使う。長押し（または上へ払う）と一覧が開き、指をすべらせて離すと選び替わる。
 * ジェスチャの判定は src/input/slot-gesture.ts（純粋）。ここは Pointer Events・一覧の表示・ボタンの見た目だけ。
 * 何を使うか・選ぶかは呼ぶ側（onTap / onChoose）。入力層はロジックを知らない（touch.ts と同じ約束）。
 */

export interface SlotOption {
  id: string;
  /** 一覧・ボタンに出す名前の短い表記と、補足（名前など） */
  label: string;
  sub?: string;
  /** 持っている数（数字のバッジ。0 なら薄く出す）。無ければバッジなし */
  count?: number;
  /** 色（CSS。瓶の中身の色） */
  color?: string;
}

export interface SlotButtonConfig {
  /** ボタン本体（.tbtn）。中身はこのクラスが作る */
  el: HTMLElement;
  gesture?: Partial<SlotGestureConfig>;
  /** 短く押した（選んでいるものを使う） */
  onTap: () => void;
  /** 一覧から選んだ */
  onChoose: (id: string) => void;
}

/** 一覧の選択肢の円の大きさ（px。CSS の .slot-opt と合わせる） */
const OPT_SIZE = 64;

function div(cls: string, text?: string): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

/** 瓶のかたち（CSS。中身の色は --c）。ボタンと一覧で同じものを使う */
function bottle(): HTMLElement {
  const b = div('slot-bottle');
  b.appendChild(div('slot-liquid'));
  return b;
}

interface OptEl {
  root: HTMLElement;
  count: HTMLElement;
}

export class SlotButton {
  private readonly el: HTMLElement;
  private readonly gesture: SlotGesture;
  private readonly cfg: SlotGestureConfig;
  private readonly menu: HTMLElement;
  private readonly opts: OptEl[] = [];
  private options: readonly SlotOption[] = [];
  private optionsKey = '';
  private readonly faceBottle: HTMLElement;
  private readonly faceLabel: HTMLElement;
  private readonly faceCount: HTMLElement;
  private faceKey = '';
  private pid: number | null = null;
  private timer = 0;
  private cx = 0;
  private cy = 0;

  constructor(private readonly c: SlotButtonConfig) {
    this.el = c.el;
    this.cfg = { ...DEFAULT_SLOT_GESTURE, ...c.gesture };
    this.gesture = new SlotGesture(this.cfg, () => this.options.length);
    this.el.classList.add('slot-btn');
    this.el.textContent = '';
    this.faceBottle = bottle();
    this.faceLabel = div('slot-label');
    this.faceCount = div('slot-count');
    this.el.append(this.faceBottle, this.faceLabel, this.faceCount);
    // 一覧はボタンの兄弟（ボタンの押し込み表示の scale に巻き込まれないように）。表示のときだけ位置を決める
    this.menu = div('slot-menu');
    this.el.parentElement?.appendChild(this.menu);
    this.bind();
  }

  /** ボタンの表示（いま選んでいるもの）。null で空表示。毎フレーム呼んでよい（変化があったときだけ DOM を触る） */
  setFace(o: SlotOption | null): void {
    const key = o ? `${o.id}|${o.label}|${o.count ?? ''}|${o.color ?? ''}` : '';
    if (key === this.faceKey) return;
    this.faceKey = key;
    this.faceBottle.style.setProperty('--c', o?.color ?? '#999');
    this.faceLabel.textContent = o?.label ?? '';
    this.faceCount.textContent = o?.count === undefined ? '' : String(o.count);
    this.el.classList.toggle('empty', o?.count === 0);
  }

  /** 一覧の中身。変化があったときだけ作り直す（開いているあいだは呼ばない想定） */
  setOptions(options: readonly SlotOption[]): void {
    const key = options.map((o) => `${o.id}|${o.label}|${o.sub ?? ''}|${o.count ?? ''}|${o.color ?? ''}`).join('\n');
    this.options = options;
    if (key === this.optionsKey) return;
    this.optionsKey = key;
    this.menu.textContent = '';
    this.opts.length = 0;
    for (const o of options) {
      const root = div('slot-opt');
      root.style.setProperty('--c', o.color ?? '#999');
      root.classList.toggle('empty', o.count === 0);
      const b = bottle();
      b.style.setProperty('--c', o.color ?? '#999');
      const name = div('slot-opt-name', o.sub ?? o.label);
      const count = div('slot-count', o.count === undefined ? '' : String(o.count));
      root.append(b, name, count);
      this.menu.appendChild(root);
      this.opts.push({ root, count });
    }
  }

  private bind(): void {
    const el = this.el;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.pid !== null) return;
      this.pid = e.pointerId;
      el.setPointerCapture(e.pointerId);
      el.classList.add('pressed');
      const r = el.getBoundingClientRect();
      this.cx = r.left + r.width / 2;
      this.cy = r.top + r.height / 2;
      this.gesture.down(e.clientX - this.cx, e.clientY - this.cy, performance.now());
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.apply(this.gesture.tick(performance.now())), this.cfg.holdMs);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pid) return;
      e.preventDefault();
      this.apply(this.gesture.move(e.clientX - this.cx, e.clientY - this.cy));
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      if (e.pointerId !== this.pid) return;
      this.pid = null;
      window.clearTimeout(this.timer);
      el.classList.remove('pressed');
      this.apply(cancelled ? this.gesture.cancel() : this.gesture.up(performance.now()));
      this.closeMenu();
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
    el.addEventListener('lostpointercapture', (e) => end(e, true));
    // 長押しで iPad の Safari が出すメニュー・選択を出さない
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private apply(ev: SlotEvent | null): void {
    if (!ev) return;
    switch (ev.type) {
      case 'open':
        this.openMenu();
        this.highlight(this.gesture.hoverIndex);
        break;
      case 'hover':
        this.highlight(ev.index);
        break;
      case 'tap':
        this.c.onTap();
        break;
      case 'choose': {
        const o = this.options[ev.index];
        if (o) this.c.onChoose(o.id);
        break;
      }
      case 'cancel':
        break;
    }
  }

  /** 一覧をボタンから dir の向きへ並べて見せる。i 番目の中心はボタンの中心から (i + 1) × pitch */
  private openMenu(): void {
    this.el.classList.add('open');
    this.menu.classList.add('show');
    for (let i = 0; i < this.opts.length; i++) {
      const d = (i + 1) * this.cfg.pitchPx;
      const s = this.opts[i]!.root.style;
      s.left = `${this.cx + this.cfg.dirX * d - OPT_SIZE / 2}px`;
      s.top = `${this.cy + this.cfg.dirY * d - OPT_SIZE / 2}px`;
    }
  }

  private closeMenu(): void {
    this.el.classList.remove('open');
    this.menu.classList.remove('show');
    this.highlight(-1);
  }

  private highlight(index: number): void {
    for (let i = 0; i < this.opts.length; i++) this.opts[i]!.root.classList.toggle('hover', i === index);
  }
}
