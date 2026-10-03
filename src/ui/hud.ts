/** HUD（DOM）。M0 はデバッグ表示と開始画面だけ */
export class Hud {
  private readonly debugEl: HTMLElement;
  private readonly overlay: HTMLElement;
  private lastDebugUpdate = 0;
  private fpsAccum = 0;
  private fpsCount = 0;
  private fps = 0;

  constructor() {
    this.debugEl = document.getElementById('debug')!;
    this.overlay = document.getElementById('start-overlay')!;
  }

  /** 開始画面のタップを待つ */
  waitForStart(): Promise<void> {
    return new Promise((resolve) => {
      const go = (e: Event) => {
        e.preventDefault();
        this.overlay.removeEventListener('pointerdown', go);
        this.overlay.classList.add('hidden');
        resolve();
      };
      this.overlay.addEventListener('pointerdown', go);
    });
  }

  hideStart(): void {
    this.overlay.classList.add('hidden');
  }

  setStartHint(text: string): void {
    const el = this.overlay.querySelector('.start-hint');
    if (el) el.textContent = text;
  }

  /** 毎描画フレーム呼ぶ。表示更新は 4Hz に間引く */
  updateDebug(frameDt: number, now: number, lines: () => string): void {
    this.fpsAccum += frameDt;
    this.fpsCount++;
    if (now - this.lastDebugUpdate < 250) return;
    this.lastDebugUpdate = now;
    this.fps = this.fpsCount / Math.max(this.fpsAccum, 1e-6);
    this.fpsAccum = 0;
    this.fpsCount = 0;
    this.debugEl.textContent = `${this.fps.toFixed(0)} fps\n${lines()}`;
  }

  setDebugVisible(v: boolean): void {
    this.debugEl.style.display = v ? '' : 'none';
  }
}
