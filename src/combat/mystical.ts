import { MYSTICAL } from './data/mystical';

/**
 * ミスティカルドッジ（ADR-030）の状態。three にも DOM にも依存しない純粋なクラス。
 *
 * 時間の遅らせ方: 敵・敵の弾の sim は「ステップを間引く」。毎 sim ステップ step() を呼び、true が返ったステップだけ敵を 1 ステップ進める
 * （enemyScale 0.2 なら 5 回に 1 回）。敵の中の数え方（フレーム・クールダウン・攻撃の持続）はそのままで済み、遅くなるのは「時間」だけになる。
 * 間引くと、敵の見た目は 1 ステップ進む間じっと止まってから跳ぶので、描画は visualAlpha() の補間係数を使う（敵の前ステップ → 今ステップを、遅い時間で補間する）。
 */

/** 浮動小数の足し算の誤差（0.2 を 5 回足して 1 に届かない）で 1 ステップずれないための許容 */
const EPS = 1e-9;

export class Mystical {
  /** 続きの残り（sim フレーム。0 = 発動していない） */
  remaining = 0;
  /** いまの発動の長さ（sim フレーム。durationFrames + AGI による加算） */
  private total: number = MYSTICAL.durationFrames;
  /** 次に成功できるまでの残り（sim フレーム） */
  cooldown = 0;
  /** 敵の時間の端数（0 以上 1 未満）。毎ステップ enemyScale ずつ溜まり、1 に届いたら敵を進める */
  private acc = 0;

  get active(): boolean {
    return this.remaining > 0;
  }

  /** 敵の時間の倍率（発動中 enemyScale、それ以外 1） */
  get scale(): number {
    return this.remaining > 0 ? MYSTICAL.enemyScale : 1;
  }

  /** 残りの割合（1 → 0。HUD・画面の色に使う）。発動していなければ 0 */
  get ratio(): number {
    return this.remaining / this.total;
  }

  /** 終わりの手前の合図の区間か */
  get warning(): boolean {
    return this.remaining > 0 && this.remaining <= MYSTICAL.warnFrames;
  }

  /** 次の発動までの割合（0 = いつでも、1 = 発動した直後）。HUD の再使用の表示に使う */
  get cooldownRatio(): number {
    return this.cooldown / MYSTICAL.cooldownFrames;
  }

  /** いま発動できるか（発動中でも、クールダウン中でもない） */
  get ready(): boolean {
    return this.remaining <= 0 && this.cooldown <= 0;
  }

  /** 発動する。できたら true（発動中・クールダウン中は何もしないで false）。bonusFrames は続く長さの加算（AGI。Modifiers.mysticalFrames） */
  trigger(bonusFrames = 0): boolean {
    if (!this.ready) return false;
    this.total = MYSTICAL.durationFrames + Math.max(0, Math.round(bonusFrames));
    this.remaining = this.total;
    this.cooldown = MYSTICAL.cooldownFrames;
    this.acc = 0;
    return true;
  }

  /**
   * 毎 sim ステップ（敵を進める前）に呼ぶ。時間を 1 ステップ進め、このステップで敵と敵の弾を進めるなら true。
   * 発動していなければ常に true（等倍）
   */
  step(): boolean {
    if (this.cooldown > 0) this.cooldown--;
    if (this.remaining <= 0) return true;
    this.remaining--;
    if (this.remaining <= 0) {
      // 切れた: 端数は捨てて、このステップから等倍に戻る（敵の見た目の補間が跳ばないよう acc も 0 にそろえる）
      this.acc = 0;
      return true;
    }
    this.acc += MYSTICAL.enemyScale;
    if (this.acc >= 1 - EPS) {
      this.acc = Math.max(0, this.acc - 1);
      return true;
    }
    return false;
  }

  /**
   * 敵・敵の弾の見た目の補間係数。alpha は sim の補間（前ステップ → 今ステップ）。
   * 敵は 1/scale ステップに 1 回しか進まないので、その間の進み具合（端数 acc + alpha × scale）で補間する。等倍のときは alpha そのもの
   */
  visualAlpha(alpha: number): number {
    if (this.remaining <= 0) return alpha;
    return Math.min(1, this.acc + alpha * MYSTICAL.enemyScale);
  }

  /** 最初の状態に戻す（再戦・死亡・リザルト）。クールダウンも消す */
  reset(): void {
    this.remaining = 0;
    this.cooldown = 0;
    this.acc = 0;
  }
}
