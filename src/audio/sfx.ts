import { MAX_VOICES, SFX, type Layer, type SfxDef, type SfxName } from './data/sfx';

/**
 * 効果音の再生（ADR-017）。レシピ（data/sfx.ts）を WebAudio のノードに組んで鳴らす。
 * 出力先は SfxBackend（実機は platform/audio.ts の AudioBus、開発用の書き出しはオフラインのコンテキスト）。
 * 鳴らせない状態（解放前・ミュート）では何もしない。
 */

/** 鳴らすのに必要なものだけを持つ出力先 */
export interface SfxBackend {
  readonly ready: boolean;
  readonly context: BaseAudioContext | null;
  readonly output: AudioNode | null;
  readonly noiseBuffer: AudioBuffer | null;
}

export interface PlayOptions {
  /** 音量の倍率（距離による減衰など） */
  gain?: number;
  /** 鳴らし始めるまでの秒（攻撃の振りの瞬間に合わせるなど） */
  delay?: number;
  /** 音程の倍率 */
  pitch?: number;
}

/** 同時に鳴っている音の数の上限を守る（純粋ロジック。時間は AudioContext の currentTime） */
export class VoiceLimiter {
  private readonly ends: number[] = [];

  constructor(readonly max: number) {}

  /** 開始 start・終了 end の音を鳴らしてよければ記録して true。上限なら false */
  acquire(start: number, end: number): boolean {
    // start より前に終わった音は数えない
    for (let i = this.ends.length - 1; i >= 0; i--) if (this.ends[i]! <= start) this.ends.splice(i, 1);
    if (this.ends.length >= this.max) return false;
    this.ends.push(end);
    return true;
  }

  get active(): number {
    return this.ends.length;
  }
}

/** レシピ 1 つの長さ（秒）= 一番遅く終わる層の delay + dur */
export function sfxDuration(def: SfxDef): number {
  let end = 0;
  for (const l of def.layers) end = Math.max(end, (l.delay ?? 0) + l.dur);
  return end;
}

/** 距離による音量の倍率（敵の音。近いほど大きく、遠くても完全には消えない）。d は聞き手（プレイヤー）からの距離（m） */
export function distanceGain(d: number): number {
  return 1 / (1 + 0.12 * Math.max(0, d));
}

const FLOOR = 0.0001; // 指数ランプの下限（0 にはできない）

export class Sfx {
  private readonly limiter = new VoiceLimiter(MAX_VOICES);

  constructor(private readonly backend: SfxBackend) {}

  /** 鳴らせたら true */
  play(name: SfxName, opts: PlayOptions = {}): boolean {
    const b = this.backend;
    const ctx = b.context;
    const out = b.output;
    if (!b.ready || !ctx || !out) return false;
    const def: SfxDef = SFX[name];
    const start = ctx.currentTime + 0.004 + Math.max(0, opts.delay ?? 0);
    const dur = sfxDuration(def);
    if (!this.limiter.acquire(start, start + dur + 0.05)) return false;

    const pitch = opts.pitch ?? 1;
    const bus = ctx.createGain();
    bus.gain.value = def.gain * (opts.gain ?? 1);
    bus.connect(out);
    let last: AudioScheduledSourceNode | null = null;
    let lastEnd = -1;
    for (const layer of def.layers) {
      const src = this.buildLayer(ctx, layer, start, pitch, bus);
      const end = (layer.delay ?? 0) + layer.dur;
      if (src && end >= lastEnd) {
        last = src;
        lastEnd = end;
      }
    }
    // 一番最後に終わる層が止まったら、ノードの接続を外して片付ける
    if (last) last.onended = () => bus.disconnect();
    return true;
  }

  private buildLayer(ctx: BaseAudioContext, layer: Layer, start: number, pitch: number, dest: AudioNode): AudioScheduledSourceNode | null {
    const t0 = start + (layer.delay ?? 0);
    const t1 = t0 + layer.dur;
    const env = ctx.createGain();
    env.gain.setValueAtTime(FLOOR, t0);
    env.gain.linearRampToValueAtTime(layer.peak, t0 + Math.min(layer.attack, layer.dur * 0.9));
    env.gain.exponentialRampToValueAtTime(FLOOR, t1);
    env.connect(dest);

    if (layer.kind === 'tone') {
      const osc = ctx.createOscillator();
      osc.type = layer.wave;
      osc.frequency.setValueAtTime(layer.from * pitch, t0);
      osc.frequency.exponentialRampToValueAtTime(layer.to * pitch, t1);
      osc.connect(env);
      osc.start(t0);
      osc.stop(t1 + 0.02);
      return osc;
    }

    const buf = this.backend.noiseBuffer;
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // 毎回違う位置から（同じ雑音を繰り返し聴かせない）。長さ 0.8 秒までの音なら 1 秒のバッファに収まる
    const offset = Math.random() * Math.max(0, buf.duration - layer.dur - 0.05);
    const filter = ctx.createBiquadFilter();
    filter.type = layer.filter;
    filter.Q.value = layer.q;
    filter.frequency.setValueAtTime(layer.from * pitch, t0);
    filter.frequency.exponentialRampToValueAtTime(layer.to * pitch, t1);
    src.connect(filter);
    filter.connect(env);
    src.start(t0, offset, layer.dur + 0.02);
    return src;
  }
}
