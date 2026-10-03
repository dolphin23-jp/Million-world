/**
 * 画面の揺れ（カメラシェイク）。強さ amp（m）が時間とともに 2 乗で減衰する高周波の振動で、x / y のオフセットを返す。
 * 実時間（描画の dt）で進める。ヒットストップ中も揺れ続けるのが狙い（止まった絵の中で震える）。
 * 重なったときは、いまの揺れの残りより強いものだけが置き換える（弱い攻撃の揺れが強い揺れを打ち切らない）。
 */

export class Shake {
  private amp = 0;
  private duration = 0;
  private time = 0;
  /** 直近の update で求めたオフセット（m）。カメラのローカルの右・上 */
  x = 0;
  y = 0;

  /** いま出ている揺れの強さ（残りの減衰を含む） */
  get current(): number {
    if (this.time <= 0 || this.duration <= 0) return 0;
    const k = this.time / this.duration;
    return this.amp * k * k;
  }

  trigger(amp: number, seconds: number): void {
    if (amp <= 0 || seconds <= 0) return;
    if (amp < this.current) return;
    this.amp = amp;
    this.duration = seconds;
    this.time = seconds;
  }

  /** frameDt は実時間（秒）。経過した時間 t（0 → duration）で振動の位相を決める */
  update(frameDt: number): void {
    if (this.time <= 0) {
      this.x = 0;
      this.y = 0;
      return;
    }
    this.time = Math.max(0, this.time - frameDt);
    const a = this.current;
    const t = this.duration - this.time;
    this.x = Math.sin(t * 96) * a;
    this.y = Math.cos(t * 81 + 1.3) * a * 0.8;
  }

  reset(): void {
    this.time = 0;
    this.x = 0;
    this.y = 0;
  }
}
