/**
 * 固定タイムステップのゲームループ（ADR-004）。
 * シミュレーションは常に stepDt 刻み。描画は rAF ごとに、残り時間の割合 alpha を渡す。
 * FixedStepper は DOM に依存しない純粋なロジックで、vitest で検証する。
 */

export const SIM_HZ = 60;
export const STEP_DT = 1 / SIM_HZ;

export interface StepperOptions {
  /** 1 フレームで消化できる最大 sim ステップ数。超えたら残りを捨てる（死のスパイラル防止） */
  maxStepsPerFrame?: number;
  /** 1 フレームの実時間の上限（秒）。タブ復帰時の巨大 dt を抑える */
  maxFrameDt?: number;
}

export class FixedStepper {
  readonly stepDt: number;
  private readonly maxSteps: number;
  private readonly maxFrameDt: number;
  private accumulator = 0;
  /** ヒットストップ等で使う時間スケール。0 で sim 停止、描画は続く */
  timeScale = 1;
  /** 累計 sim フレーム数 */
  frame = 0;

  constructor(stepDt = STEP_DT, opts: StepperOptions = {}) {
    this.stepDt = stepDt;
    this.maxSteps = opts.maxStepsPerFrame ?? 5;
    this.maxFrameDt = opts.maxFrameDt ?? 0.25;
  }

  /**
   * 実時間 frameDt（秒）を与え、必要な回数だけ step を呼ぶ。
   * 戻り値は補間係数 alpha（0..1）。
   */
  advance(frameDt: number, step: (dt: number) => void): number {
    const dt = Math.min(Math.max(frameDt, 0), this.maxFrameDt);
    this.accumulator += dt * this.timeScale;
    let steps = 0;
    while (this.accumulator >= this.stepDt && steps < this.maxSteps) {
      step(this.stepDt);
      this.accumulator -= this.stepDt;
      this.frame++;
      steps++;
    }
    if (steps >= this.maxSteps) {
      // 追いつけないときは残りを捨てて現在に合わせる
      this.accumulator = 0;
    }
    return this.accumulator / this.stepDt;
  }

  reset(): void {
    this.accumulator = 0;
  }
}

export interface LoopCallbacks {
  step: (dt: number) => void;
  render: (alpha: number, frameDt: number) => void;
}

/** requestAnimationFrame を回す薄い殻。ブラウザ依存部分はここだけ */
export class GameLoop {
  readonly stepper: FixedStepper;
  private running = false;
  private lastTime = 0;
  private rafId = 0;

  constructor(private readonly cb: LoopCallbacks, stepper = new FixedStepper()) {
    this.stepper = stepper;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.stepper.reset();
    const tick = (now: number) => {
      if (!this.running) return;
      const frameDt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      const alpha = this.stepper.advance(frameDt, this.cb.step);
      this.cb.render(alpha, frameDt);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
