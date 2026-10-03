import { MASTER_GAIN, SFX, type SfxName } from '../audio/data/sfx';
import { Sfx, sfxDuration } from '../audio/sfx';

/**
 * 効果音の書き出し（開発用。`?sfxlab=1` のときだけ読み込む）。実機で鳴らさずに、同じレシピ・同じ出力の構成（マスター → コンプレッサ）を
 * OfflineAudioContext でサンプル列にして返す。tools/sfx-check.mjs が、無音・クリップ・尻切れ・長さを数値で検査し、WAV に書き出す。
 */

export interface SfxLab {
  names: SfxName[];
  sampleRate: number;
  render(name: SfxName): Promise<{ samples: number[]; seconds: number }>;
}

const SAMPLE_RATE = 44100;

export function installSfxLab(): SfxLab {
  const render = async (name: SfxName) => {
    const seconds = sfxDuration(SFX[name]) + 0.15;
    const ctx = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * seconds), SAMPLE_RATE);
    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    master.connect(comp);
    comp.connect(ctx.destination);
    const len = ctx.sampleRate;
    const noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const sfx = new Sfx({ ready: true, context: ctx, output: master, noiseBuffer: noise });
    sfx.play(name);
    const buf = await ctx.startRendering();
    return { samples: Array.from(buf.getChannelData(0)), seconds };
  };
  return { names: Object.keys(SFX) as SfxName[], sampleRate: SAMPLE_RATE, render };
}
