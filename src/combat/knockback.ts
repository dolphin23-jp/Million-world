/**
 * ノックバック。「距離 distance（m）を frames フレームで進んで止まる」を、速度を一定割合で落とす動きで作る。
 * 初速 v0 から 1 フレームごとに v0 / frames ずつ落とすと、frames 回のステップで進む距離は dt × v0 × (frames + 1) / 2 になる。
 * これが distance になるよう v0 = 2 × distance / (dt × (frames + 1)) とする（連続近似の 2 × 距離 / 時間 より少しだけ遅い）。
 * 毎 sim ステップ、velX / velZ を位置に足し、そのあと step() で速度を落とす。
 */

export class Knockback {
  velX = 0;
  velZ = 0;
  private decayX = 0;
  private decayZ = 0;
  private remaining = 0;

  get active(): boolean {
    return this.remaining > 0;
  }

  /** dir は単位ベクトル（XZ）。distance <= 0 または frames <= 0 なら何もしない */
  start(dirX: number, dirZ: number, distance: number, frames: number): void {
    if (distance <= 0 || frames <= 0) return;
    const v0 = (2 * distance * 60) / (frames + 1);
    this.velX = dirX * v0;
    this.velZ = dirZ * v0;
    this.decayX = this.velX / frames;
    this.decayZ = this.velZ / frames;
    this.remaining = frames;
  }

  /** 1 sim ステップ後に呼ぶ。速度を 1 フレーム分落とす */
  step(): void {
    if (this.remaining <= 0) return;
    this.remaining--;
    if (this.remaining === 0) {
      this.velX = 0;
      this.velZ = 0;
    } else {
      this.velX -= this.decayX;
      this.velZ -= this.decayZ;
    }
  }

  cancel(): void {
    this.remaining = 0;
    this.velX = 0;
    this.velZ = 0;
  }
}
