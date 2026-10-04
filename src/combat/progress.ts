import { TIER_MAX } from '../ai/data/tiers';

/**
 * 挑戦の進み具合（M6-4。ADR-036）: どの段階（敵の色違い・強さ）までクリアしたか・いま選んでいる段階。
 * 段階 n をクリアすると n + 1 が解放される（最初は段階 1 だけ）。解放済みの段階なら、いつでも選び直せる（低い段階で遊び直してもよい）。
 * 純粋なクラス（three にも DOM にも時間にも依存しない）。セーブ（save.ts）に入る。
 */

export interface ProgressSnapshot {
  /** クリアした最高の段階（0 = まだ何もクリアしていない） */
  cleared: number;
  /** 選んでいる段階（1 以上、解放済みの範囲） */
  tier: number;
}

const int = (v: unknown, lo: number, hi: number, def: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : def;
  return Math.min(hi, Math.max(lo, n));
};

export class Progress {
  cleared = 0;
  tier = 1;
  /** 何かが変わるたびに増える（セーブ・画面の合図） */
  serial = 0;

  constructor(init?: Partial<ProgressSnapshot>) {
    if (init) this.restore(init);
  }

  /** 保存したものから戻す。範囲を丸め、解放していない段階を選んでいたら解放済みの最高に戻す */
  private restore(s: Partial<ProgressSnapshot>): void {
    this.cleared = int(s.cleared, 0, TIER_MAX, 0);
    this.tier = Math.min(this.unlocked, int(s.tier, 1, TIER_MAX, 1));
    this.serial++;
  }

  /** 挑める最高の段階（クリアした最高 + 1。最大は TIER_MAX） */
  get unlocked(): number {
    return Math.min(TIER_MAX, this.cleared + 1);
  }

  canSelect(tier: number): boolean {
    return Number.isInteger(tier) && tier >= 1 && tier <= this.unlocked;
  }

  /** 段階を選ぶ（解放済みのときだけ）。選べたら true */
  select(tier: number): boolean {
    if (!this.canSelect(tier)) return false;
    if (this.tier !== tier) {
      this.tier = tier;
      this.serial++;
    }
    return true;
  }

  /** 段階 tier をクリアした。新しく次の段階が解放されたら、その段階を返す（なければ null） */
  onClear(tier: number): number | null {
    if (!this.canSelect(tier) || tier <= this.cleared) return null;
    this.cleared = tier;
    this.serial++;
    return this.cleared < TIER_MAX ? this.cleared + 1 : null;
  }

  /** 次の段階（いま選んでいる段階の次。解放済みで、上限でなければ。なければ null）。リザルトの「次の段階へ」 */
  get next(): number | null {
    const n = this.tier + 1;
    return n <= this.unlocked ? n : null;
  }

  toSnapshot(): ProgressSnapshot {
    return { cleared: this.cleared, tier: this.tier };
  }

  /** 最初から（セーブの消去） */
  reset(): void {
    this.cleared = 0;
    this.tier = 1;
    this.serial++;
  }
}
