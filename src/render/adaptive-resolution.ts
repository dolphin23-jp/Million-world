/**
 * 動的解像度（ADR-011）。実フレーム間隔を見て、描画の pixelRatio を段階的に上下させる。
 * DOM にも WebGL にも依存しない純粋なロジックで、vitest で検証する。
 *
 * iPad Pro（DPR 2）をそのまま描くと重いので、既定は 1.5 倍までに抑えている（RendererHost）。
 * それでも重い場面（影・輪郭線・ブルームが重なる）では 1.25 → 1.0 と落とし、余裕が続けば戻す。
 * 戻すのに失敗した（上げたらすぐ下げることになった）段は、次に試すまでの待ちを倍にして振動を防ぐ。
 */

export interface AdaptiveOptions {
  /** 大きい順の pixelRatio 段。デバイスの DPR を超える段は呼び出し側で潰しておく */
  levels: number[];
  /** この平均フレーム間隔（ms）を超えたら 1 段下げる。60Hz の vsync を外し始める目安 */
  slowMs?: number;
  /** この平均フレーム間隔（ms）以下なら「余裕あり」と数える */
  fastMs?: number;
  /** 判定する窓のフレーム数 */
  windowFrames?: number;
  /** 起動直後・段の切り替え直後に捨てるフレーム数（シェーダのコンパイルやバッファ再確保を避ける） */
  settleFrames?: number;
  /** 余裕ありが何窓続いたら 1 段戻してみるか（最初の値） */
  upAfterWindows?: number;
  /** 戻す待ちの上限（窓数） */
  upAfterMax?: number;
  /** これを超える 1 フレームは外れ値（タブ復帰・GC）として数えない（ms） */
  outlierMs?: number;
}

export class AdaptiveResolution {
  enabled = true;
  private readonly levels: number[];
  private readonly slowMs: number;
  private readonly fastMs: number;
  private readonly windowFrames: number;
  private readonly settleFrames: number;
  private readonly upAfterBase: number;
  private readonly upAfterMax: number;
  private readonly outlierMs: number;

  private idx = 0;
  private settle: number;
  private sum = 0;
  private n = 0;
  private fastWindows = 0;
  /** 段ごとの「戻す前に待つ窓数」。戻して失敗するたびに倍にする */
  private readonly upAfter: number[];
  /** 直近に上げた直後か（この窓で遅ければ「戻し失敗」とみなす） */
  private justRaised = false;

  constructor(opts: AdaptiveOptions) {
    this.levels = opts.levels.length ? [...opts.levels] : [1];
    this.slowMs = opts.slowMs ?? 21;
    this.fastMs = opts.fastMs ?? 17.6;
    this.windowFrames = opts.windowFrames ?? 60;
    this.settleFrames = opts.settleFrames ?? 60;
    this.upAfterBase = opts.upAfterWindows ?? 6;
    this.upAfterMax = opts.upAfterMax ?? 96;
    this.outlierMs = opts.outlierMs ?? 200;
    this.settle = this.settleFrames * 2; // 起動直後は特に長めに捨てる
    this.upAfter = this.levels.map(() => this.upAfterBase);
  }

  get ratio(): number {
    return this.levels[this.idx] ?? 1;
  }

  get level(): number {
    return this.idx;
  }

  /** 段が 1 つしかない（調整の余地がない） */
  get inert(): boolean {
    return this.levels.length <= 1;
  }

  /** 外から段を固定したいとき（?dpr= 指定など）。以後 update は何もしない */
  lock(): void {
    this.enabled = false;
  }

  /**
   * 実フレーム間隔（ms）を渡す。段が変わったときだけ新しい pixelRatio を返す。
   */
  update(frameMs: number): number | null {
    if (!this.enabled || this.inert) return null;
    if (frameMs > this.outlierMs || !(frameMs > 0)) return null;
    if (this.settle > 0) {
      this.settle--;
      return null;
    }
    this.sum += frameMs;
    this.n++;
    if (this.n < this.windowFrames) return null;

    const avg = this.sum / this.n;
    this.sum = 0;
    this.n = 0;

    if (avg > this.slowMs && this.idx < this.levels.length - 1) {
      if (this.justRaised) {
        // 戻したのにダメだった: この段へ戻すのは次から慎重にする
        const up = this.idx; // 今いる（失敗した）段
        this.upAfter[up] = Math.min(this.upAfterMax, (this.upAfter[up] ?? this.upAfterBase) * 2);
      }
      return this.move(+1);
    }
    this.justRaised = false;

    if (avg <= this.fastMs && this.idx > 0) {
      this.fastWindows++;
      // 戻す待ちは「戻したい先の段」の値（失敗履歴のある段ほど長い）
      if (this.fastWindows >= (this.upAfter[this.idx - 1] ?? this.upAfterBase)) {
        const r = this.move(-1);
        this.justRaised = true;
        return r;
      }
    } else {
      this.fastWindows = 0;
    }
    return null;
  }

  private move(dir: 1 | -1): number {
    this.idx = Math.min(this.levels.length - 1, Math.max(0, this.idx + dir));
    this.settle = this.settleFrames;
    this.fastWindows = 0;
    return this.ratio;
  }
}

/** デバイスの DPR を超えない、重複のない降順の段を作る */
export function buildLevels(dpr: number, candidates: number[]): number[] {
  const out: number[] = [];
  for (const c of [...candidates].sort((a, b) => b - a)) {
    const v = Math.min(dpr, c);
    if (!out.includes(v)) out.push(v);
  }
  return out;
}
