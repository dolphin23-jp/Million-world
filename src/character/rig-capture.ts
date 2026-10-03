import { Quaternion, Vector3, type AnimationClip, type Interpolant, type Object3D } from 'three';
import { trackInterpolant } from './animator';
import type { CharacterAsset } from './loader';
import { BONE, Rig, type BoneDesc, type ExtraBone, type HingeAxes, type RigData } from './rig';

/**
 * 読み込んだキャラ資産（GLB）から、手付けアニメ用の Rig を作る。
 * - 骨の親子・位置は資産のスケルトンから（Armature の 0.01 倍で cm → m）
 * - 基準ポーズは idle クリップの t=0（バインドポーズは左右非対称で、そのままだと片腕が浮く）
 * - 肘・膝の蝶番軸は、走りクリップで肘膝が大きく曲がっているフレームから求める
 *   （曲がる面の法線 = cross(上腕の向き, 前腕の向き) を、上腕・前腕それぞれのローカル空間へ戻して平均する）
 * - 資産のシーングラフは読むだけで書き換えない（クリップは補間器で直接評価する）
 */

export interface CaptureOptions {
  idleClip: string;
  /** 肘膝がよく曲がるクリップ（走り） */
  hingeClip: string;
  /** 右手の指の向き（手ボーンのローカル、HERO.hand.right.f）。手首の曲がりの診断用 */
  handFinger: readonly [number, number, number];
  /** 剣のグリップ（HERO.sword）。手ボーンのローカルの位置 cm と、剣 → 手ボーンの回転 xyzw */
  grip: { posCm: readonly [number, number, number]; quat: readonly [number, number, number, number] };
}

export interface CaptureReport {
  /** 資産の長さ単位 → m の倍率（Armature の scale。cm なら 0.01） */
  unit: number;
  /** 蝶番軸の較正に使ったフレーム数と、サンプル間のばらつき（平均軸からの最大の角度、度） */
  hinge: Record<keyof RigData['hinges'], { frames: number; spreadDeg: number }>;
}

export interface CapturedRig {
  rig: Rig;
  extras: ExtraBone[];
  report: CaptureReport;
}

const LIMBS = [
  ['armR', BONE.armR, BONE.foreR, BONE.handR],
  ['armL', BONE.armL, BONE.foreL, BONE.handL],
  ['legR', BONE.upLegR, BONE.legR, BONE.footR],
  ['legL', BONE.upLegL, BONE.legL, BONE.footL],
] as const;

/** 蝶番軸の較正に使う、肘膝の曲がりの下限（度） */
const MIN_BEND_DEG = 30;
const HINGE_SAMPLES = 120;

class ClipSampler {
  private readonly interps = new Map<string, Interpolant>();
  constructor(readonly clip: AnimationClip) {
    for (const t of clip.tracks) this.interps.set(t.name, trackInterpolant(t));
  }
  has(name: string): boolean {
    return this.interps.has(name);
  }
  quat(bone: string, t: number, out: Quaternion): boolean {
    const i = this.interps.get(`${bone}.quaternion`);
    if (!i) return false;
    const v = i.evaluate(t);
    out.set(v[0]!, v[1]!, v[2]!, v[3]!);
    return true;
  }
  vec(bone: string, t: number, out: Vector3): boolean {
    const i = this.interps.get(`${bone}.position`);
    if (!i) return false;
    const v = i.evaluate(t);
    out.set(v[0]!, v[1]!, v[2]!);
    return true;
  }
}

function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`rig-capture: ${what}`);
  return v;
}

export function captureRig(asset: CharacterAsset, opts: CaptureOptions): CapturedRig {
  const hipsBone = must(asset.bones.get(BONE.hips), `ボーンがありません: ${BONE.hips}`);
  const armature = must(hipsBone.parent ?? undefined, 'Hips に親（Armature）がありません');
  // キャラ基準（+Z 前・右 −X）= Armature のローカル × unit。Armature より上は回転なし・等倍であること
  const unit = armature.scale.x;
  if (Math.abs(armature.scale.y - unit) > 1e-6 || Math.abs(armature.scale.z - unit) > 1e-6) throw new Error('rig-capture: Armature の scale が等方でありません');
  if (armature.quaternion.angleTo(new Quaternion()) > 1e-4) throw new Error('rig-capture: Armature が回転しています（手付けは identity を前提にしている）');
  for (let o: Object3D | null = armature.parent; o && o !== asset.root.parent; o = o.parent) {
    if (o.quaternion.angleTo(new Quaternion()) > 1e-4 || Math.abs(o.scale.x - 1) > 1e-6) throw new Error(`rig-capture: 親 ${o.name} が回転・拡縮しています`);
  }

  const idleClip = must(asset.clips.get(opts.idleClip), `クリップがありません: ${opts.idleClip}`);
  const hingeClip = must(asset.clips.get(opts.hingeClip), `クリップがありません: ${opts.hingeClip}`);
  const idle = new ClipSampler(idleClip);

  const rigNames = new Set<string>(Object.values(BONE));
  const bones: BoneDesc[] = [];
  const tmpV = new Vector3();
  const tmpQ = new Quaternion();
  for (const name of Object.values(BONE)) {
    const b = must(asset.bones.get(name), `ボーンがありません: ${name}`);
    const parentName = b.parent && rigNames.has(b.parent.name) ? b.parent.name : null;
    if (name !== BONE.hips && parentName === null) throw new Error(`rig-capture: ${name} の親が Rig の骨ではありません (${b.parent?.name})`);
    const pos = idle.vec(name, 0, tmpV) ? tmpV.clone() : b.position.clone();
    const q = idle.quat(name, 0, tmpQ) ? tmpQ.clone() : b.quaternion.clone();
    bones.push({ name, parent: parentName, pos: pos.multiplyScalar(unit), idleQuat: q });
  }
  const hipsPos = bones[0]!.pos.clone();

  const extras: ExtraBone[] = [];
  for (const [name, b] of asset.bones) {
    if (rigNames.has(name)) continue;
    extras.push({ name, quat: idle.quat(name, 0, tmpQ) ? tmpQ.clone() : b.quaternion.clone() });
  }

  const dummy = (): HingeAxes => ({ u: new Vector3(1, 0, 0), f: new Vector3(1, 0, 0) });
  const data: RigData = {
    bones,
    hipsPos,
    handFinger: new Vector3(...opts.handFinger).normalize(),
    unit,
    hinges: { armR: dummy(), armL: dummy(), legR: dummy(), legL: dummy() },
    grip: {
      pos: new Vector3(...opts.grip.posCm).multiplyScalar(unit),
      quat: new Quaternion(...opts.grip.quat).normalize(),
    },
  };
  const rig = new Rig(data);
  const hinge = calibrateHinges(rig, hingeClip, unit);
  data.hinges = hinge.axes;

  return { rig, extras, report: { unit, hinge: hinge.report } };
}

function calibrateHinges(rig: Rig, clip: AnimationClip, unit: number): { axes: RigData['hinges']; report: CaptureReport['hinge'] } {
  const sampler = new ClipSampler(clip);
  const n = rig.names.length;
  const local = rig.idleLocal.map((q) => q.clone());
  const Q = rig.names.map(() => new Quaternion());
  const P = rig.names.map(() => new Vector3());
  const hips = new Vector3();
  const sums = {} as Record<string, { u: Vector3[]; f: Vector3[] }>;
  for (const [key] of LIMBS) sums[key] = { u: [], f: [] };

  const dU = new Vector3();
  const dF = new Vector3();
  const h = new Vector3();
  for (let s = 0; s < HINGE_SAMPLES; s++) {
    const t = (s / (HINGE_SAMPLES - 1)) * clip.duration;
    for (let i = 0; i < n; i++) sampler.quat(rig.names[i]!, t, local[i]!);
    if (!sampler.vec(BONE.hips, t, hips)) hips.copy(rig.data.hipsPos).divideScalar(unit);
    rig.fk(local, hips.clone().multiplyScalar(unit), Q, P);
    for (const [key, up, fore, end] of LIMBS) {
      const iu = rig.mustIndex(up);
      const iF = rig.mustIndex(fore);
      const ie = rig.mustIndex(end);
      dU.subVectors(P[iF]!, P[iu]!).normalize();
      dF.subVectors(P[ie]!, P[iF]!).normalize();
      const bend = Math.acos(Math.max(-1, Math.min(1, dU.dot(dF))));
      if (bend < (MIN_BEND_DEG * Math.PI) / 180) continue;
      h.crossVectors(dU, dF).normalize();
      sums[key]!.u.push(h.clone().applyQuaternion(Q[iu]!.clone().invert()));
      sums[key]!.f.push(h.clone().applyQuaternion(Q[iF]!.clone().invert()));
    }
  }

  const axes = {} as RigData['hinges'];
  const report = {} as CaptureReport['hinge'];
  for (const [key] of LIMBS) {
    const { u, f } = sums[key]!;
    if (u.length === 0) throw new Error(`rig-capture: ${key} が ${MIN_BEND_DEG}° 以上曲がるフレームがクリップにありません`);
    const mean = (a: Vector3[]): Vector3 => a.reduce((acc, v) => acc.add(v), new Vector3()).normalize();
    const mu = mean(u);
    const mf = mean(f);
    const spread = Math.max(...u.map((v) => v.angleTo(mu)), ...f.map((v) => v.angleTo(mf)));
    axes[key] = { u: mu, f: mf };
    report[key] = { frames: u.length, spreadDeg: (spread * 180) / Math.PI };
  }
  return { axes, report };
}
