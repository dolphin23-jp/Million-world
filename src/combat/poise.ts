import type { PoiseDef } from './data/poise';

/**
 * 体勢ゲージ（純粋ロジック。ADR-027）。受けたダメージぶん減り、0 になった瞬間に「崩れた」を返す。
 * 最後に受けてから regenDelayFrames 経つと少しずつ回復する。崩れたあと動けないあいだは回復せず、立て直したところで満タンに戻す（refill）。
 */
export class Poise {
  value: number;
  /** 最後に体勢ダメージを受けてからの sim フレーム */
  private since = Infinity;

  constructor(readonly def: PoiseDef) {
    this.value = def.max;
  }

  /** 0..1（1 = 満タン） */
  get ratio(): number {
    return this.value / this.def.max;
  }

  /** 体勢ダメージを受ける。このダメージで 0 になった（崩れた）ら true */
  hit(damage: number): boolean {
    this.since = 0;
    if (this.value <= 0) return false;
    this.value = Math.max(0, this.value - damage);
    return this.value <= 0;
  }

  /** 1 sim ステップ。動けない状態のあいだは呼ばない */
  step(): void {
    this.since++;
    if (this.since > this.def.regenDelayFrames && this.value < this.def.max) {
      this.value = Math.min(this.def.max, this.value + this.def.regenPerFrame);
    }
  }

  /** 立て直した: 満タンに戻す */
  refill(): void {
    this.value = this.def.max;
    this.since = Infinity;
  }
}
