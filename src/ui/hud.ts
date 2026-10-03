/** HUD（DOM）。デバッグ表示・開始画面・プレイヤーの HP バー・被弾の画面フラッシュ */
export class Hud {
  private readonly debugEl: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpLag: HTMLElement;
  private readonly hurtFlashEl: HTMLElement;
  private readonly targetEl: HTMLElement;
  private readonly targetFill: HTMLElement;
  private readonly targetLag: HTMLElement;
  private readonly targetName: HTMLElement;
  private targetShown = false;
  private lastDebugUpdate = 0;
  private fpsAccum = 0;
  private fpsCount = 0;
  private fps = 0;

  constructor() {
    this.debugEl = document.getElementById('debug')!;
    this.overlay = document.getElementById('start-overlay')!;
    const hp = document.getElementById('hp-player')!;
    this.hpFill = hp.querySelector('.hp-fill') as HTMLElement;
    this.hpLag = hp.querySelector('.hp-lag') as HTMLElement;
    this.hurtFlashEl = document.getElementById('hurt-flash')!;
    this.targetEl = document.getElementById('hp-target')!;
    this.targetFill = this.targetEl.querySelector('.hp-fill') as HTMLElement;
    this.targetLag = this.targetEl.querySelector('.hp-lag') as HTMLElement;
    this.targetName = this.targetEl.querySelector('.hp-name') as HTMLElement;
  }

  /** ロック対象の HP バー（プレイヤーの HP の下）。null で隠す。毎フレーム呼んでよい（変化があったときだけ DOM を触る） */
  setTarget(t: { name: string; hp: number; max: number } | null): void {
    if (!t) {
      if (this.targetShown) {
        this.targetEl.style.display = 'none';
        this.targetShown = false;
      }
      return;
    }
    if (!this.targetShown) {
      this.targetEl.style.display = '';
      this.targetShown = true;
      // 別の対象に変わった直後は、白い遅れ帯を現在値に揃えてから縮み始めさせる
      this.targetLag.style.transition = 'none';
      this.targetLag.style.width = `${Math.max(0, Math.min(1, t.hp / t.max)) * 100}%`;
      void this.targetLag.offsetWidth;
      this.targetLag.style.transition = '';
    }
    if (this.targetName.textContent !== t.name) this.targetName.textContent = t.name;
    const w = `${Math.max(0, Math.min(1, t.hp / t.max)) * 100}%`;
    if (this.targetFill.style.width !== w) {
      this.targetFill.style.width = w;
      this.targetLag.style.width = w;
    }
  }

  /** プレイヤーの HP バー。減った分は白い帯が遅れて縮む（CSS の transition） */
  setPlayerHp(hp: number, max: number): void {
    const w = `${Math.max(0, Math.min(1, hp / max)) * 100}%`;
    this.hpFill.style.width = w;
    this.hpLag.style.width = w;
  }

  /** 被弾の画面フラッシュ（縁が赤くなる）。連続で呼ばれたらアニメーションをやり直す */
  flashHurt(): void {
    const el = this.hurtFlashEl;
    el.classList.remove('on');
    void el.offsetWidth; // 同じクラスを付け直してもアニメーションが再始動するよう、再計算を挟む
    el.classList.add('on');
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
