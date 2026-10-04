import type { ResultSummary } from '../game/encounter';

/** リザルトを出してから「もう一度」を押せるようになるまで（ms）。連打の指で一瞬で再戦しないように */
const RETRY_ARM_MS = 1100;

/** HUD（DOM）。デバッグ表示・開始画面・プレイヤーの HP バー・被弾の画面フラッシュ */
export class Hud {
  private readonly debugEl: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpLag: HTMLElement;
  private readonly hurtFlashEl: HTMLElement;
  private readonly mysticFx: HTMLElement;
  private readonly mysticGauge: HTMLElement;
  private readonly mysticFill: HTMLElement;
  /** ミスティカルの表示の直近の状態（変化があったときだけ DOM を触る） */
  private mysticKey = '';
  private readonly targetEl: HTMLElement;
  private readonly targetFill: HTMLElement;
  private readonly targetLag: HTMLElement;
  private readonly targetName: HTMLElement;
  private readonly targetPoiseFill: HTMLElement;
  private readonly bossEl: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossLag: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossPoiseFill: HTMLElement;
  private bossShown = false;
  /** 段階の目盛りを作り済みのボス（作り直さないため） */
  private bossTicksFor: string | null = null;
  private targetShown = false;
  private readonly bannerEl: HTMLElement;
  private readonly resultEl: HTMLElement;
  private readonly retryBtn: HTMLElement;
  private retryCb: (() => void) | null = null;
  private armTimer = 0;
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
    this.mysticFx = document.getElementById('mystical-fx')!;
    this.mysticGauge = document.getElementById('mystical-gauge')!;
    this.mysticFill = this.mysticGauge.querySelector('.mystical-fill') as HTMLElement;
    this.targetEl = document.getElementById('hp-target')!;
    this.targetFill = this.targetEl.querySelector('.hp-fill') as HTMLElement;
    this.targetLag = this.targetEl.querySelector('.hp-lag') as HTMLElement;
    this.targetName = this.targetEl.querySelector('.hp-name') as HTMLElement;
    this.targetPoiseFill = this.targetEl.querySelector('.poise-fill') as HTMLElement;
    this.bossEl = document.getElementById('hp-boss')!;
    this.bossFill = this.bossEl.querySelector('.hp-fill') as HTMLElement;
    this.bossLag = this.bossEl.querySelector('.hp-lag') as HTMLElement;
    this.bossName = this.bossEl.querySelector('.hp-name') as HTMLElement;
    this.bossPoiseFill = this.bossEl.querySelector('.poise-fill') as HTMLElement;
    this.bannerEl = document.getElementById('banner')!;
    this.resultEl = document.getElementById('result')!;
    this.retryBtn = document.getElementById('result-retry')!;
    // pointerdown で受ける（開始画面と同じ。iOS のタップは click より早く確実）
    this.retryBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.retry();
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Enter' || e.code === 'Space') this.retry();
    });
  }

  /** 「もう一度」を押したときに呼ぶものを登録する */
  onRetry(cb: () => void): void {
    this.retryCb = cb;
  }

  private retry(): void {
    if (!this.retryBtn.classList.contains('armed')) return;
    this.retryCb?.();
  }

  /** ウェーブのバナー（画面の上寄りに流れて消える） */
  showBanner(text: string): void {
    const span = this.bannerEl.querySelector('span') as HTMLElement;
    span.textContent = text;
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth; // 付け直しでアニメーションを再始動する
    this.bannerEl.classList.add('show');
  }

  /** リザルト（勝ち: ランクあり / 負け）。「もう一度」は RETRY_ARM_MS 経ってから押せる */
  showResult(r: ResultSummary): void {
    const el = this.resultEl;
    const win = r.phase === 'victory';
    el.classList.toggle('defeat', !win);
    (el.querySelector('.result-title') as HTMLElement).textContent = win ? 'VICTORY' : 'DEFEAT';
    (el.querySelector('.result-rank span') as HTMLElement).textContent = r.rank ?? '';
    (document.getElementById('r-kills') as HTMLElement).textContent = String(r.kills);
    (document.getElementById('r-time') as HTMLElement).textContent = formatTime(r.seconds);
    (document.getElementById('r-damage') as HTMLElement).textContent = String(r.damageTaken);
    (document.getElementById('r-hits') as HTMLElement).textContent = `${r.hitsTaken} 回`;
    (document.getElementById('r-parries') as HTMLElement).textContent = `${r.parries} 回`;
    this.retryBtn.classList.remove('armed');
    el.classList.remove('hidden');
    // アニメーションを頭から
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    window.clearTimeout(this.armTimer);
    this.armTimer = window.setTimeout(() => this.retryBtn.classList.add('armed'), RETRY_ARM_MS);
  }

  hideResult(): void {
    window.clearTimeout(this.armTimer);
    this.retryBtn.classList.remove('armed');
    this.resultEl.classList.add('hidden');
  }

  /** ロック対象の HP バー（プレイヤーの HP の下）。null で隠す。毎フレーム呼んでよい（変化があったときだけ DOM を触る） */
  /**
   * ボスの HP バー（画面上部）。null で隠す。phases は段階の境目（HP の割合。目盛りを出す）、poise は体勢ゲージ 0..1。
   * ボスがいるあいだは、ロック対象の HP の位置を下へずらす（CSS の boss-on）
   */
  setBoss(b: { name: string; hp: number; max: number; poise: number | null; phases: readonly number[] } | null): void {
    if (!b) {
      if (this.bossShown) {
        this.bossEl.style.display = 'none';
        document.body.classList.remove('boss-on');
        this.bossShown = false;
        this.bossTicksFor = null;
      }
      return;
    }
    if (!this.bossShown) {
      this.bossEl.style.display = '';
      document.body.classList.add('boss-on');
      this.bossShown = true;
      // 現れた直後は、白い遅れ帯を現在値に揃えてから縮み始めさせる
      this.bossLag.style.transition = 'none';
      this.bossLag.style.width = `${Math.max(0, Math.min(1, b.hp / b.max)) * 100}%`;
      void this.bossLag.offsetWidth;
      this.bossLag.style.transition = '';
    }
    if (this.bossName.textContent !== b.name) this.bossName.textContent = b.name;
    const key = `${b.name}:${b.phases.join(',')}`;
    if (this.bossTicksFor !== key) {
      this.bossTicksFor = key;
      this.bossEl.querySelectorAll('.phase-tick').forEach((el) => el.remove());
      for (const p of b.phases) {
        const tick = document.createElement('div');
        tick.className = 'phase-tick';
        tick.style.left = `${p * 100}%`;
        this.bossEl.appendChild(tick);
      }
    }
    const w = `${Math.max(0, Math.min(1, b.hp / b.max)) * 100}%`;
    if (this.bossFill.style.width !== w) {
      this.bossFill.style.width = w;
      this.bossLag.style.width = w;
    }
    const hasPoise = b.poise !== null;
    this.bossEl.classList.toggle('has-poise', hasPoise);
    if (hasPoise) {
      this.bossPoiseFill.style.width = `${Math.max(0, Math.min(1, b.poise!)) * 100}%`;
      this.bossEl.querySelector('.poise')!.classList.toggle('broken', b.poise! <= 0);
    }
  }

  setTarget(t: { name: string; hp: number; max: number; /** 体勢ゲージ 0..1（重装型だけ） */ poise?: number | null } | null): void {
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
    const hasPoise = t.poise !== undefined && t.poise !== null;
    this.targetEl.classList.toggle('has-poise', hasPoise);
    if (hasPoise) {
      this.targetPoiseFill.style.width = `${Math.max(0, Math.min(1, t.poise!)) * 100}%`;
      this.targetEl.classList.toggle('poise-broken', t.poise! <= 0);
    }
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

  /**
   * ミスティカルドッジ（ADR-030）の表示。state = active（発動中。ratio は残り 1 → 0）/ cooling（次まで待ち。ratio は溜まり具合 0 → 1）/ ready（隠す）。
   * warn は終わりの手前（点滅）。毎フレーム呼んでよい（変化があったときだけ DOM を触る）
   */
  setMystical(state: 'active' | 'cooling' | 'ready', ratio: number, warn: boolean): void {
    const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 200) / 2; // 0.5% 刻み
    const key = `${state}:${pct}:${warn ? 1 : 0}`;
    if (key === this.mysticKey) return;
    this.mysticKey = key;
    const on = state === 'active';
    this.mysticFx.classList.toggle('on', on);
    this.mysticFx.classList.toggle('warn', on && warn);
    this.mysticGauge.dataset.state = state;
    this.mysticGauge.classList.toggle('warn', on && warn);
    this.mysticFill.style.width = `${pct}%`;
  }

  /** 被弾の画面フラッシュ（縁が赤くなる）。連続で呼ばれたらアニメーションをやり直す */
  flashHurt(): void {
    const el = this.hurtFlashEl;
    el.classList.remove('on');
    void el.offsetWidth; // 同じクラスを付け直してもアニメーションが再始動するよう、再計算を挟む
    el.classList.add('on');
  }

  /**
   * 開始画面のタップを待つ。onTap はタップのイベントの中で同期的に呼ぶ（iOS は音声の解放を「ユーザーの操作の中」でしか許さない）
   */
  waitForStart(onTap?: () => void): Promise<void> {
    return new Promise((resolve) => {
      const go = (e: Event) => {
        e.preventDefault();
        onTap?.();
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

  /**
   * 開始画面の装備の選択を作る。チップをタップしても開始しない（開始画面全体の pointerdown へ伝えない）。
   * onPick は選んだ装備の id を受け取る（保存や装備の反映は呼ぶ側）
   */
  setupLoadoutPicker(items: readonly { id: string; name: string; detail: string }[], current: string, onPick: (id: string) => void): void {
    const root = document.getElementById('loadout-pick');
    if (!root) return;
    root.textContent = '';
    const chips: HTMLElement[] = [];
    for (const it of items) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'loadout-chip';
      chip.dataset.loadout = it.id;
      const b = document.createElement('b');
      b.textContent = it.name;
      const small = document.createElement('small');
      small.textContent = it.detail;
      chip.append(b, small);
      chip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation(); // 開始画面のタップ（ゲーム開始）にしない
        for (const c of chips) c.classList.toggle('selected', c === chip);
        onPick(it.id);
      });
      chip.classList.toggle('selected', it.id === current);
      chips.push(chip);
      root.appendChild(chip);
    }
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

/** 秒を「m:ss.s」に（例: 83.4 → 1:23.4） */
export function formatTime(seconds: number): string {
  // 先に 0.1 秒に丸める（59.96 秒が「0:60.0」にならず「1:00.0」になるように）
  const t = Math.round(Math.max(0, seconds) * 10) / 10;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
