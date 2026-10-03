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

export function sliceClip(src: THREE.AnimationClip, name: string, start: number, end: number, fps = 30): THREE.AnimationClip {
  const dur = Math.max(0, end - start);
  const n = Math.max(2, Math.round(dur * fps) + 1);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of src.tracks) {
    const size = track.getValueSize();
    // createInterpolant は実行時には存在するが型定義に無いので、補間方式に応じて明示的に呼ぶ
    const interp =
      track.getInterpolation() === THREE.InterpolateDiscrete
        ? track.InterpolantFactoryMethodDiscrete()
        : track.getInterpolation() === THREE.InterpolateSmooth
          ? track.InterpolantFactoryMethodSmooth()
          : track.InterpolantFactoryMethodLinear();
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
