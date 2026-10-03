import { describe, expect, it } from 'vitest';
import { Sfx, VoiceLimiter, distanceGain, sfxDuration, type SfxBackend } from './sfx';
import { MAX_VOICES, SFX, type SfxName } from './data/sfx';

// ---- 偽の WebAudio（ノードのスケジュールだけを記録する） ----
class FakeParam {
  value = 0;
  calls: { kind: 'set' | 'lin' | 'exp'; v: number; t: number }[] = [];
  setValueAtTime(v: number, t: number) { this.calls.push({ kind: 'set', v, t }); }
  linearRampToValueAtTime(v: number, t: number) { this.calls.push({ kind: 'lin', v, t }); }
  exponentialRampToValueAtTime(v: number, t: number) { this.calls.push({ kind: 'exp', v, t }); }
}
class FakeNode {
  to: FakeNode[] = [];
  disconnected = false;
  connect(n: FakeNode) { this.to.push(n); return n; }
  disconnect() { this.disconnected = true; }
}
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeScheduled extends FakeNode {
  started: number[] = [];
  stopped: number[] = [];
  onended: (() => void) | null = null;
  start(t: number, offset?: number, dur?: number) { this.started.push(t); if (offset !== undefined) this.offset = offset; if (dur !== undefined) this.sliceDur = dur; }
  stop(t: number) { this.stopped.push(t); }
  offset = -1;
  sliceDur = -1;
}
class FakeOsc extends FakeScheduled { type = 'sine'; frequency = new FakeParam(); }
class FakeSource extends FakeScheduled { buffer: unknown = null; }
class FakeFilter extends FakeNode { type = 'lowpass'; Q = { value: 0 }; frequency = new FakeParam(); }

function makeCtx(now = 10) {
  const made = { gains: [] as FakeGain[], oscs: [] as FakeOsc[], sources: [] as FakeSource[], filters: [] as FakeFilter[] };
  const ctx = {
    currentTime: now,
    createGain: () => { const n = new FakeGain(); made.gains.push(n); return n; },
    createOscillator: () => { const n = new FakeOsc(); made.oscs.push(n); return n; },
    createBufferSource: () => { const n = new FakeSource(); made.sources.push(n); return n; },
    createBiquadFilter: () => { const n = new FakeFilter(); made.filters.push(n); return n; },
  };
  return { ctx, made };
}

function backend(over: Partial<{ ready: boolean; noise: boolean; now: number }> = {}) {
  const { ctx, made } = makeCtx(over.now ?? 10);
  const output = new FakeNode();
  const b = {
    ready: over.ready ?? true,
    context: ctx as unknown as BaseAudioContext,
    output: output as unknown as AudioNode,
    noiseBuffer: (over.noise ?? true) ? ({ duration: 1 } as unknown as AudioBuffer) : null,
  } satisfies SfxBackend;
  return { b, ctx, made, output };
}

const names = Object.keys(SFX) as SfxName[];

describe('効果音のレシピ（data/sfx.ts）', () => {
  it('すべてのレシピの数値が有効: 周波数 > 0、長さ > 0、attack ≤ dur、peak は 0 超 1 以下、gain は 0 超 1 以下', () => {
    for (const n of names) {
      const def = SFX[n];
      expect(def.gain, n).toBeGreaterThan(0);
      expect(def.gain, n).toBeLessThanOrEqual(1);
      expect(def.layers.length, n).toBeGreaterThan(0);
      for (const l of def.layers) {
        expect(l.from, n).toBeGreaterThan(0);
        expect(l.to, n).toBeGreaterThan(0);
        expect(l.dur, n).toBeGreaterThan(0);
        expect(l.attack, n).toBeGreaterThan(0);
        expect(l.attack, n).toBeLessThanOrEqual(l.dur);
        expect(l.peak, n).toBeGreaterThan(0);
        expect(l.peak, n).toBeLessThanOrEqual(1);
        expect(l.delay ?? 0, n).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('1 つの音は 1.2 秒以内（雑音バッファは 1 秒で、層の長さ 0.9 秒までが収まる）', () => {
    for (const n of names) {
      expect(sfxDuration(SFX[n]), n).toBeLessThanOrEqual(1.2);
      for (const l of SFX[n].layers) if (l.kind === 'noise') expect(l.dur + 0.05, n).toBeLessThan(0.95);
    }
  });

  it('ゲームが使う音がそろっている', () => {
    for (const n of ['swing1', 'swing2', 'swing3', 'swingHeavy', 'dodge', 'hit', 'hitHeavy', 'kill', 'hurt', 'telegraph', 'enemySwing', 'lock', 'switch', 'unlock', 'ui', 'wave', 'victory', 'defeat'] as const) {
      expect(names, n).toContain(n);
    }
  });
});

describe('distanceGain', () => {
  it('近いほど大きく、離れるほど小さい。0 で 1、遠くても 0 にはならない', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(3)).toBeLessThan(distanceGain(1));
    expect(distanceGain(10)).toBeLessThan(distanceGain(3));
    expect(distanceGain(20)).toBeGreaterThan(0.2);
    expect(distanceGain(-5)).toBe(1);
  });
});

describe('VoiceLimiter', () => {
  it('上限まで受け付け、上限なら断る。終わった音は数えない', () => {
    const v = new VoiceLimiter(2);
    expect(v.acquire(0, 1)).toBe(true);
    expect(v.acquire(0.1, 0.5)).toBe(true);
    expect(v.acquire(0.2, 0.9)).toBe(false);
    expect(v.acquire(0.6, 1.2)).toBe(true); // 0.5 で終わった音が空く
    expect(v.active).toBe(2);
    expect(v.acquire(5, 6)).toBe(true); // みんな終わっている
    expect(v.active).toBe(1);
  });
});

describe('Sfx.play', () => {
  it('鳴らせない状態（解放前・ミュート）では何もせず false', () => {
    const { b, made } = backend({ ready: false });
    const sfx = new Sfx(b);
    expect(sfx.play('hit')).toBe(false);
    expect(made.gains).toHaveLength(0);
  });

  it('レシピの層ぶんのノードを組み、出力へつなぎ、開始・終了をスケジュールする', () => {
    const { b, made, output } = backend({ now: 10 });
    const sfx = new Sfx(b);
    expect(sfx.play('hit')).toBe(true);
    const def = SFX.hit;
    const tones = def.layers.filter((l) => l.kind === 'tone').length;
    const noises = def.layers.filter((l) => l.kind === 'noise').length;
    expect(made.oscs).toHaveLength(tones);
    expect(made.sources).toHaveLength(noises);
    expect(made.filters).toHaveLength(noises);
    // 全体のゲイン（bus）が出力へつながる。bus の音量は def.gain
    const bus = made.gains[0]!;
    expect(bus.gain.value).toBeCloseTo(def.gain, 9);
    expect(bus.to).toContain(output);
    for (const o of made.oscs) {
      expect(o.started[0]!).toBeGreaterThanOrEqual(10);
      expect(o.stopped[0]!).toBeGreaterThan(o.started[0]!);
    }
    for (const s of made.sources) expect(s.started[0]!).toBeGreaterThanOrEqual(10);
  });

  it('gain・delay・pitch が効く', () => {
    const a = backend({ now: 10 });
    new Sfx(a.b).play('telegraph', { gain: 0.5, delay: 0.3, pitch: 2 });
    expect(a.made.gains[0]!.gain.value).toBeCloseTo(SFX.telegraph.gain * 0.5, 9);
    const osc = a.made.oscs[0]!;
    expect(osc.started[0]!).toBeGreaterThanOrEqual(10.3);
    const first = SFX.telegraph.layers[0]!;
    expect(osc.frequency.calls[0]!.v).toBeCloseTo(first.from * 2, 9);
    expect(osc.frequency.calls[1]!.v).toBeCloseTo(first.to * 2, 9);
  });

  it('音量のエンベロープは attack で peak まで上がり、dur で下限まで消える（NaN・負の値なし）', () => {
    const { b, made } = backend();
    new Sfx(b).play('swingHeavy');
    for (const g of made.gains.slice(1)) {
      for (const c of g.gain.calls) {
        expect(Number.isFinite(c.v)).toBe(true);
        expect(Number.isFinite(c.t)).toBe(true);
        expect(c.v).toBeGreaterThan(0);
      }
      const [set, lin, exp] = g.gain.calls;
      expect(set!.kind).toBe('set');
      expect(lin!.kind).toBe('lin');
      expect(exp!.kind).toBe('exp');
      expect(lin!.t).toBeGreaterThan(set!.t);
      expect(exp!.t).toBeGreaterThan(lin!.t);
    }
  });

  it('雑音は毎回違う位置から再生し、層の長さを超えない', () => {
    const { b, made } = backend();
    const sfx = new Sfx(b);
    sfx.play('swing1');
    sfx.play('swing1');
    const offsets = made.sources.map((s) => s.offset);
    expect(offsets.every((o) => o >= 0 && o < 1)).toBe(true);
    expect(new Set(offsets).size).toBeGreaterThan(1);
  });

  it('雑音バッファがなければ雑音の層だけ省く（音は鳴る）', () => {
    const { b, made } = backend({ noise: false });
    expect(new Sfx(b).play('hit')).toBe(true);
    expect(made.sources).toHaveLength(0);
    expect(made.oscs.length).toBeGreaterThan(0);
  });

  it('最後に終わる層が止まったら、接続を外して片付ける', () => {
    const { b, made } = backend();
    new Sfx(b).play('hit');
    const bus = made.gains[0]!;
    const ending = [...made.oscs, ...made.sources].filter((n) => n.onended);
    expect(ending).toHaveLength(1);
    expect(bus.disconnected).toBe(false);
    ending[0]!.onended!();
    expect(bus.disconnected).toBe(true);
  });

  it('同時発音数の上限を超える音は鳴らさない（時間が進めば空く）', () => {
    const { b, ctx } = backend({ now: 10 });
    const sfx = new Sfx(b);
    let ok = 0;
    for (let i = 0; i < MAX_VOICES + 6; i++) if (sfx.play('hitHeavy')) ok++;
    expect(ok).toBe(MAX_VOICES);
    ctx.currentTime = 12; // みんな終わった
    expect(sfx.play('hitHeavy')).toBe(true);
  });
});
