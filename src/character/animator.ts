import * as THREE from 'three';

/**
 * アニメーション再生の薄い層。
 * - 名前でクリップを登録し、クロスフェードで切り替える
 * - sliceClip で元クリップの一部区間を独立したクリップにする（固定 fps で再サンプルするので、
 *   キーが疎な trackでも区間内に必ずキーが入る。AnimationUtils.subclip はキーが無い track を落として
 *   ポーズが崩れることがあるため使わない）
 */

export interface PlayOptions {
  loop?: boolean;
  /** クロスフェード秒 */
  fade?: number;
  /** 再生速度 */
  rate?: number;
  /** 終端で止める（loop=false のとき） */
  clamp?: boolean;
  /** 同じクリップが再生中でも頭から再生し直す */
  restart?: boolean;
}

/** トラックの補間器。createInterpolant は実行時には存在するが型定義に無いので、補間方式に応じて明示的に呼ぶ */
export function trackInterpolant(track: THREE.KeyframeTrack): THREE.Interpolant {
  return track.getInterpolation() === THREE.InterpolateDiscrete
    ? track.InterpolantFactoryMethodDiscrete()
    : track.getInterpolation() === THREE.InterpolateSmooth
      ? track.InterpolantFactoryMethodSmooth()
      : track.InterpolantFactoryMethodLinear();
}

export function sliceClip(src: THREE.AnimationClip, name: string, start: number, end: number, fps = 30): THREE.AnimationClip {
  const dur = Math.max(0, end - start);
  const n = Math.max(2, Math.round(dur * fps) + 1);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of src.tracks) {
    const size = track.getValueSize();
    const interp = trackInterpolant(track);
    const times = new Float32Array(n);
    const values = new Float32Array(n * size);
    for (let i = 0; i < n; i++) {
      const t = Math.min(end, start + (i / (n - 1)) * dur);
      times[i] = t - start;
      const v = interp.evaluate(t) as Float32Array;
      values.set(v.subarray(0, size), i * size);
    }
    const Ctor = track.constructor as new (name: string, times: ArrayLike<number>, values: ArrayLike<number>) => THREE.KeyframeTrack;
    tracks.push(new Ctor(track.name, times, values));
  }
  return new THREE.AnimationClip(name, dur, tracks);
}

/** トラックが動かす骨の名前（'LeftArm.quaternion' → 'LeftArm'） */
function trackBone(track: THREE.KeyframeTrack): string {
  return track.name.slice(0, track.name.lastIndexOf('.'));
}

/**
 * base のクリップの、指定した骨（bones）のトラックを、pose のクリップの時刻 at の姿勢で固定したトラックに置き換えたクリップを作る。
 * 上半身（腕）だけ別の姿勢のまま、下半身・胴は元の動きのままにしたいとき（大剣を構えたままの走り）に使う。
 * 置き換える骨は、固定の姿勢を base の全長（2 キー）で保つ。胴は元の動きのままなので、腕は胴に付いたまま胴と一緒に揺れる。
 */
export function overlayPose(name: string, base: THREE.AnimationClip, pose: THREE.AnimationClip, bones: ReadonlySet<string>, at: number): THREE.AnimationClip {
  const tracks = base.tracks.filter((t) => !bones.has(trackBone(t)));
  for (const track of pose.tracks) {
    if (!bones.has(trackBone(track))) continue;
    const size = track.getValueSize();
    const v = (trackInterpolant(track).evaluate(at) as Float32Array).subarray(0, size);
    const values = new Float32Array(size * 2);
    values.set(v, 0);
    values.set(v, size);
    const Ctor = track.constructor as new (name: string, times: ArrayLike<number>, values: ArrayLike<number>) => THREE.KeyframeTrack;
    tracks.push(new Ctor(track.name, [0, base.duration], values));
  }
  return new THREE.AnimationClip(name, base.duration, tracks);
}

export class Animator {
  readonly mixer: THREE.AnimationMixer;
  private readonly clips = new Map<string, THREE.AnimationClip>();
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  currentName: string | null = null;

  constructor(root: THREE.Object3D, clips: Iterable<[string, THREE.AnimationClip]>) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const [name, clip] of clips) this.clips.set(name, clip);
  }

  has(name: string): boolean {
    return this.clips.has(name);
  }

  getClip(name: string): THREE.AnimationClip | undefined {
    return this.clips.get(name);
  }

  /** できあがったクリップをそのまま登録する（手付けアニメ用） */
  addClip(name: string, clip: THREE.AnimationClip): void {
    this.clips.set(name, clip);
  }

  /** 既存クリップの区間から新しい名前のクリップを作る */
  defineSegment(name: string, source: string, start: number, end: number): void {
    const src = this.clips.get(source);
    if (!src) throw new Error(`クリップがありません: ${source}`);
    this.clips.set(name, sliceClip(src, name, start, end));
  }

  duration(name: string): number {
    return this.clips.get(name)?.duration ?? 0;
  }

  play(name: string, opts: PlayOptions = {}): THREE.AnimationAction | null {
    const clip = this.clips.get(name);
    if (!clip) return null;
    const fade = opts.fade ?? 0.15;
    const rate = opts.rate ?? 1;
    let action = this.actions.get(name);
    if (!action) {
      action = this.mixer.clipAction(clip);
      this.actions.set(name, action);
    }
    const loop = opts.loop ?? true;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = opts.clamp ?? !loop;
    action.timeScale = rate;

    if (this.current === action && !opts.restart) return action;

    action.enabled = true;
    action.reset();
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(rate);
    if (this.current && this.current !== action) {
      this.current.crossFadeTo(action, fade, false);
    } else if (this.current === action) {
      action.fadeIn(0.05);
    } else {
      action.fadeIn(fade);
    }
    action.play();
    this.current = action;
    this.currentName = name;
    return action;
  }

  setRate(rate: number): void {
    if (this.current) this.current.timeScale = rate;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }
}
