/**
 * ヒットストップ（ADR-004）。命中の瞬間に sim を数フレームだけ止める。
 * 止めるのは sim（FixedStepper.timeScale = 0）で、描画・カメラ・UI は止めない（止まった絵の中で震える・数字が出るのが手触りになる）。
 * 長さは sim フレーム（60Hz）で指定し、実時間（描画フレームの dt）で数える。sim が止まっている間は sim フレームでは数えられないため。
 *
 * 重なったときは足さずに長いほうを取る（連続ヒットで止まりっぱなしにならない）。
 */

export class HitStop {
  private remaining = 0;

  /** frames は sim フレーム。0 以下は無視 */
  trigger(frames: number): void {
    if (frames <= 0) return;
    this.remaining = Math.max(this.remaining, frames / 60);
  }

  get active(): boolean {
    return this.remaining > 0;
  }

  /**
   * 毎描画フレーム（実時間 frameDt 秒）。戻り値は sim の timeScale（止めている間 0、それ以外 1）。
   * 止まっている描画フレームの数は 60Hz の描画で frames ちょうど（命中の sim ステップの直後の描画を 1 つめとして数える）
   */
  update(frameDt: number): number {
    if (this.remaining <= 0) return 1;
    this.remaining -= frameDt;
    // 60 で割った小数の誤差で、尽きたはずなのに 1 フレーム余計に止まらないようにする
    if (this.remaining < 1e-9) this.remaining = 0;
    return 0;
  }

  reset(): void {
    this.remaining = 0;
  }
}
