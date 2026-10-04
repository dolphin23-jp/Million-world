import { DEFAULT_SLOT_GESTURE, SlotGesture, type SlotEvent, type SlotGestureConfig } from './slot-gesture';

/**
 * スロットボタン（DOM。ADR-030）。アイテム欄・将来のスキル欄が使い回す部品。
 * ボタンには「いま選んでいるもの」を出し、タップでそれを使う。長押し（または上へ払う）と一覧が開き、指をすべらせて離すと選び替わる。
 * ジェスチャの判定は src/input/slot-gesture.ts（純粋）。ここは Pointer Events・一覧の表示・ボタンの見た目だけ。
 * 何を使うか・選ぶかは呼ぶ側（onTap / onChoose）。入力層はロジックを知らない（touch.ts と同じ約束）。
 */

/** 絵柄。bottle = 薬瓶（アイテム）、blade = 剣（スキル） */
export type SlotIcon = 'bottle' | 'blade';

export interface SlotOption {
  id: string;
  /** 一覧・ボタンに出す名前の短い表記と、補足（名前など） */
  label: string;
  sub?: string;
  /** 角の小さな丸に出す文字（アイテムは持っている数、スキルは「Lv3」など）。無ければ出さない */
  badge?: string;
  /** 薄く出す（持っていない・使えない）。選ぶことはできる */
  dim?: boolean;
  /** 絵柄（省略 = bottle） */
  icon?: SlotIcon;
  /** 色（CSS。瓶の中身・剣の刃の色） */
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

/** 絵柄（CSS。色は --c）。ボタンと一覧で同じものを使う */
function icon(kind: SlotIcon = 'bottle'): HTMLElement {
  if (kind === 'blade') {
    const b = div('slot-blade');
    b.append(div('slot-blade-edge'), div('slot-blade-guard'));
    return b;
  }
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
  private readonly faceIcon: HTMLElement;
  private readonly faceLabel: HTMLElement;
  private readonly faceBadge: HTMLElement;
  private readonly cooldownEl: HTMLElement;
  private faceKey = '';
  private cooldownKey = -1;
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
    this.faceIcon = div('slot-icon');
    this.faceLabel = div('slot-label');
    this.faceBadge = div('slot-count');
    // 使い直しの待ち: 暗い扇が時計回りに消えていく（--cd は残りの度数）
    this.cooldownEl = div('slot-cd');
    this.el.append(this.faceIcon, this.faceLabel, this.faceBadge, this.cooldownEl);
    // 一覧はボタンの兄弟（ボタンの押し込み表示の scale に巻き込まれないように）。表示のときだけ位置を決める
    this.menu = div('slot-menu');
    this.el.parentElement?.appendChild(this.menu);
    this.bind();
  }

  /** ボタンの表示（いま選んでいるもの）。null で空表示。毎フレーム呼んでよい（変化があったときだけ DOM を触る） */
  setFace(o: SlotOption | null): void {
    const key = o ? `${o.id}|${o.label}|${o.badge ?? ''}|${o.dim ? 1 : 0}|${o.icon ?? ''}|${o.color ?? ''}` : '';
    if (key === this.faceKey) return;
    this.faceKey = key;
    this.faceIcon.textContent = '';
    if (o) {
      const ic = icon(o.icon);
      ic.style.setProperty('--c', o.color ?? '#999');
      this.faceIcon.appendChild(ic);
    }
    this.faceLabel.textContent = o?.label ?? '';
    this.faceBadge.textContent = o?.badge ?? '';
    this.faceBadge.classList.toggle('long', (o?.badge?.length ?? 0) > 2);
    this.el.classList.toggle('empty', o?.dim === true);
  }

  /**
   * 使い直しの待ち（0 = 使える、1 = 使った直後）。ボタンの上に暗い扇が回る。毎フレーム呼んでよい（1% 刻みで変わったときだけ DOM を触る）。
   * 待ちのあいだはボタンを薄く見せる（cooling）
   */
  setCooldown(ratio: number): void {
    const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    if (pct === this.cooldownKey) return;
    this.cooldownKey = pct;
    this.cooldownEl.style.setProperty('--cd', `${pct * 3.6}deg`);
    this.cooldownEl.classList.toggle('on', pct > 0);
    this.el.classList.toggle('cooling', pct > 0);
  }

  /** 一覧の中身。変化があったときだけ作り直す（開いているあいだは呼ばない想定） */
  setOptions(options: readonly SlotOption[]): void {
    const key = options.map((o) => `${o.id}|${o.label}|${o.sub ?? ''}|${o.badge ?? ''}|${o.dim ? 1 : 0}|${o.icon ?? ''}|${o.color ?? ''}`).join('\n');
    this.options = options;
    if (key === this.optionsKey) return;
    this.optionsKey = key;
    this.menu.textContent = '';
    this.opts.length = 0;
    for (const o of options) {
      const root = div('slot-opt');
      root.style.setProperty('--c', o.color ?? '#999');
      root.classList.toggle('empty', o.dim === true);
      const ic = icon(o.icon);
      ic.style.setProperty('--c', o.color ?? '#999');
      const name = div('slot-opt-name', o.sub ?? o.label);
      const badge = div('slot-count', o.badge ?? '');
      badge.classList.toggle('long', (o.badge?.length ?? 0) > 2);
      root.append(ic, name, badge);
      this.menu.appendChild(root);
      this.opts.push({ root, count: badge });
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
