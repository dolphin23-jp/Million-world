import { DEFAULT_SLOT_LAYOUT, layoutSlots, pickSlot, type SlotLayoutConfig, type SlotPoint } from './slot-layout';

/**
 * スロットボタンの操作（ADR-030・033）。アイテム欄・スキル欄が使い回す「タップで使う・長押し（またはスワイプ）で一覧を開き、指をすべらせて選ぶ」ジェスチャの状態機械。
 * DOM にも時間にも依存しない純粋なクラス（指の位置はボタンの中心からの差 (x, y) px、時刻は ms を呼ぶ側が渡す）。DOM 側は src/input/slot-button.ts。
 *
 * 操作:
 * - 短く押して離す → tap（選んでいるものを使う）
 * - 押したまま holdMs 経つ、または openDragPx を超えて指が動く → open（一覧が開く）。一覧はボタンを中心にした**同心円（扇）の上**に並び、
 *   指のいる向きと距離で選ぶ（配置と選び方は src/input/slot-layout.ts）。指がいる選択肢が hover（ボタンの近く・扇の外へ動いたら -1 = 選ばない）
 * - 開いているあいだに離す → hover の選択肢を choose。ボタンの近く・扇の外で離したら cancel（何も選ばない）
 */

export interface SlotGestureConfig {
  /** 長押しで一覧が開くまで（ms） */
  holdMs: number;
  /** 指がこの距離（px）以上動いたら、待たずに一覧を開く（払う操作） */
  openDragPx: number;
  /** 選択肢の同心円の配置・選び方 */
  layout: SlotLayoutConfig;
}

export const DEFAULT_SLOT_GESTURE: SlotGestureConfig = { holdMs: 260, openDragPx: 24, layout: DEFAULT_SLOT_LAYOUT };

export type SlotEvent =
  | { type: 'open' }
  /** index = 一覧のなかで指がいる選択肢（-1 = ボタンの近く = 選ばない） */
  | { type: 'hover'; index: number }
  | { type: 'tap' }
  | { type: 'choose'; index: number }
  | { type: 'cancel' };

type Phase = 'idle' | 'down' | 'open';

export class SlotGesture {
  private phase: Phase = 'idle';
  private downAt = 0;
  private startX = 0;
  private startY = 0;
  private curX = 0;
  private curY = 0;
  private hover = -1;

  /** 選択肢の配置（個数が変わったときだけ作り直す） */
  private points: SlotPoint[] = [];
  private pointsFor = -1;

  constructor(
    private readonly cfg: SlotGestureConfig,
    /** 一覧の選択肢の数（開く瞬間・動くたびに読む） */
    private readonly count: () => number,
  ) {}

  /** いまの選択肢の配置（ボタンの中心からの位置。描画が同じ配置を使う） */
  layout(): readonly SlotPoint[] {
    const n = this.count();
    if (n !== this.pointsFor) {
      this.pointsFor = n;
      this.points = layoutSlots(n, this.cfg.layout);
    }
    return this.points;
  }

  get isOpen(): boolean {
    return this.phase === 'open';
  }

  get isDown(): boolean {
    return this.phase !== 'idle';
  }

  /** いま指がいる選択肢（開いていなければ -1） */
  get hoverIndex(): number {
    return this.phase === 'open' ? this.hover : -1;
  }

  /** 指が置かれた。(x, y) はボタンの中心から見た位置 */
  down(x: number, y: number, nowMs: number): void {
    this.phase = 'down';
    this.downAt = nowMs;
    this.startX = this.curX = x;
    this.startY = this.curY = y;
    this.hover = -1;
  }

  /** 時間の経過（長押しの判定）。呼ぶ側が holdMs 後にタイマーで呼ぶ。開いたら open を返す */
  tick(nowMs: number): SlotEvent | null {
    if (this.phase !== 'down') return null;
    if (nowMs - this.downAt < this.cfg.holdMs) return null;
    return this.open();
  }

  /** 指が動いた。(x, y) はボタンの中心から見た位置。開いた・選択肢が変わったときだけイベントを返す */
  move(x: number, y: number): SlotEvent | null {
    if (this.phase === 'idle') return null;
    this.curX = x;
    this.curY = y;
    if (this.phase === 'down') {
      if (Math.hypot(x - this.startX, y - this.startY) < this.cfg.openDragPx) return null;
      return this.open();
    }
    const h = this.indexAt(x, y);
    if (h === this.hover) return null;
    this.hover = h;
    return { type: 'hover', index: h };
  }

  /** 指が離れた。タップ・選択・取り消しのどれかを返す */
  up(nowMs: number): SlotEvent | null {
    if (this.phase === 'idle') return null;
    // 離す直前に長押しの時間を越えていたら、開いていたものとして扱う（タイマーより先に離れた場合）
    if (this.phase === 'down') this.tick(nowMs);
    const was = this.phase;
    const hover = this.hover;
    this.phase = 'idle';
    this.hover = -1;
    if (was === 'down') return { type: 'tap' };
    return hover >= 0 ? { type: 'choose', index: hover } : { type: 'cancel' };
  }

  /** 中断（pointercancel・タブが隠れた）。何も選ばない */
  cancel(): SlotEvent | null {
    const was = this.phase;
    this.phase = 'idle';
    this.hover = -1;
    return was === 'open' ? { type: 'cancel' } : null;
  }

  private open(): SlotEvent {
    this.phase = 'open';
    this.hover = this.indexAt(this.curX, this.curY);
    return { type: 'open' };
  }

  /** (x, y)（ボタンの中心から）にいる選択肢の番号。ボタンの近く・扇の外は -1（選ばない） */
  indexAt(x: number, y: number): number {
    return pickSlot(this.layout(), x, y, this.cfg.layout);
  }
}
