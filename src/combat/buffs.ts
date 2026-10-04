import { KILL_BUFF } from './data/passives';

/**
 * 闘気（パッシブ。M6-5。ADR-037）: 敵を倒すと KILL_BUFF.frames のあいだ、攻撃力が上がる。倒すたびに 1 回重なり（最大 KILL_BUFF.maxStacks）、
 * 重なるたびに残り時間は満タンに戻る（途切れずに倒し続けると保つ）。時間が尽きると、重なりは全部いっぺんに消える。
 * 純粋なクラス（three にも DOM にも依存しない）。Game が撃破の合図で onKill、毎 sim ステップ step を呼び、bonus を Player へ渡す。
 */
export class KillBuff {
  /** いま重なっている回数 */
  stacks = 0;
  /** 残りの sim フレーム */
  remaining = 0;
  /** 変化のたびに増える（HUD の表示の合図） */
  serial = 0;

  /** 敵を倒した（闘気を持っているときだけ呼ぶ）。重なりを 1 つ足して、残り時間を戻す */
  onKill(): void {
    this.stacks = Math.min(KILL_BUFF.maxStacks, this.stacks + 1);
    this.remaining = KILL_BUFF.frames;
    this.serial++;
  }

  /** 毎 sim ステップ */
  step(): void {
    if (this.stacks === 0) return;
    if (--this.remaining <= 0) this.clear();
  }

  /** 攻撃力への加算の割合（perStack = Modifiers.killBuff。0 = 闘気なし → 0） */
  bonus(perStack: number): number {
    return perStack > 0 ? perStack * this.stacks : 0;
  }

  /** 残り時間の割合（0..1。HUD の目安） */
  get ratio(): number {
    return this.stacks === 0 ? 0 : Math.max(0, this.remaining) / KILL_BUFF.frames;
  }

  clear(): void {
    if (this.stacks === 0 && this.remaining === 0) return;
    this.stacks = 0;
    this.remaining = 0;
    this.serial++;
  }
}
