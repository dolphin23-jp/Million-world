/**
 * 音声の土台（iPad Safari 向けの作法をここに集める）。
 *
 *  - AudioContext は「ユーザーのタップの中」で resume しないと鳴らない（自動再生の制限）。unlock() を開始画面のタップから呼ぶ。
 *    それより前や、`?autostart=1` のように操作なしで始めたときは、suspended のまま黙る（落ちない）
 *  - 電話・通知・スリープから戻ると状態が `interrupted`（Safari 独自）や `suspended` になる。次のタップで resume し直す
 *    （最初のタップでの解放後も、window の pointerdown で毎回「止まっていれば再開」を試す）
 *  - タブ非表示・ホーム画面へ戻るときは suspend して、無駄に動かさない
 *  - 古い Safari は webkitAudioContext
 *  - 無音スイッチ（iPad の消音）で WebAudio が鳴らない端末がある。これはブラウザ側の仕様で、アプリからは直せない（docs/02 の既知の問題）
 */

import { MASTER_GAIN } from '../audio/data/sfx';

type AudioContextCtor = new (opts?: AudioContextOptions) => AudioContext;

function contextCtor(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** ?mute=1 など。true のあいだ何も鳴らさない */
  muted = false;

  constructor() {
    // 解放後の復帰: 止まっていたら、タップのたびに再開を試みる（成功すれば何もしない）
    window.addEventListener('pointerdown', () => this.resume(), { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.ctx?.suspend();
      else this.resume();
    });
  }

  /** タップの中で呼ぶ。コンテキストを作って resume し、無音のバッファを 1 つ鳴らす（iOS の解放の定石） */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = contextCtor();
      if (!Ctor) return;
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.buildGraph(this.ctx);
    }
    this.resume();
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  }

  private resume(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // 'interrupted' は Safari だけの状態（型に無い）
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  }

  /** 鳴らしてよい状態か（コンテキストがあり、動いていて、ミュートでない） */
  get ready(): boolean {
    return !this.muted && this.ctx !== null && this.ctx.state === 'running';
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** 出力の入口（コンプレッサ経由でマスターへ）。unlock 前は null */
  get output(): AudioNode | null {
    return this.master;
  }

  /** 白色雑音のバッファ（1 秒。全音で共有する） */
  get noiseBuffer(): AudioBuffer | null {
    return this.noise;
  }

  private buildGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    // 重なったときに歪まないよう、軽くコンプレッサを掛ける
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }
}
