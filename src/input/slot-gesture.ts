/**
 * スロットボタンの操作（ADR-030）。アイテム欄・将来のスキル欄が使い回す「タップで使う・長押し（またはスワイプ）で一覧を開き、指をすべらせて選ぶ」ジェスチャの状態機械。
 * DOM にも時間にも依存しない純粋なクラス（指の位置はボタンの中心からの差 (x, y) px、時刻は ms を呼ぶ側が渡す）。DOM 側は src/input/slot-button.ts。
 *
 * 操作:
 * - 短く押して離す → tap（選んでいるものを使う）
 * - 押したまま holdMs 経つ、または openDragPx を超えて指が動く → open（一覧が開く）。一覧はボタンから dir の向きへ伸び、i 番目（0 始まり）の選択肢は
 *   ボタンの中心から (i + 1) × pitchPx の位置にある。指がいちばん近い選択肢が hover（ボタン自身の近く = -1 は「選ばない」）
 * - 開いているあいだに離す → hover の選択肢を choose。ボタンの近くで離したら cancel（何も選ばない）
 */

export interface SlotGestureConfig {
  /** 長押しで一覧が開くまで（ms） */
  holdMs: number;
  /** 指がこの距離（px）以上動いたら、待たずに一覧を開く（上へ払う操作） */
  openDragPx: number;
  /** 選択肢の間隔（px） */
  pitchPx: number;
  /** 一覧が伸びる向き（単位ベクトル。画面座標: x 右が正、y 下が正。上へ伸ばすなら (0, -1)） */
  dirX: number;
  dirY: number;
}

export const DEFAULT_SLOT_GESTURE: SlotGestureConfig = { holdMs: 260, openDragPx: 24, pitchPx: 72, dirX: 0, dirY: -1 };

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

  constructor(
    private readonly cfg: SlotGestureConfig,
    /** 一覧の選択肢の数（開く瞬間・動くたびに読む） */
    private readonly count: () => number,
  ) {}

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

  /** (x, y) にいちばん近い選択肢の番号。ボタンの近く（1 つ目の選択肢の半分より手前）は -1、いちばん遠い選択肢より先は最後の選択肢 */
  indexAt(x: number, y: number): number {
    const n = this.count();
    if (n <= 0) return -1;
    const d = x * this.cfg.dirX + y * this.cfg.dirY; // 一覧の向きに沿った距離
    const k = Math.round(d / this.cfg.pitchPx) - 1;
    if (k < 0) return -1;
    return Math.min(n - 1, k);
  }
}
