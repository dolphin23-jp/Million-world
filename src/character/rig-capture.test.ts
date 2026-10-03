import { describe, expect, it } from 'vitest';
import { AnimationClip, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3 } from 'three';
import type { CharacterAsset } from './loader';
import { captureRig } from './rig-capture';
import { BONE } from './rig';
import { makeRig } from './test-rig';

/** 合成リグ（test-rig.ts）から、GLB を読み込んだ後と同じ形の資産（Armature 0.01 倍・cm）を作る */
function makeAsset(opts: { armatureYawDeg?: number; bend?: boolean } = {}): CharacterAsset {
  const src = makeRig();
  const root = new Group();
  const armature = new Group();
  armature.name = 'Armature';
  armature.scale.setScalar(0.01);
  if (opts.armatureYawDeg) armature.rotation.y = (opts.armatureYawDeg * Math.PI) / 180;
  root.add(armature);
  const bones = new Map<string, Bone>();
  for (const d of src.data.bones) {
    const b = new Bone();
    b.name = d.name;
    // 実際の GLB では Hips のローカル位置がそのまま腰の位置（合成リグは hipsPos を別に持つ）
    b.position.copy(d.parent ? d.pos : src.data.hipsPos).multiplyScalar(100);
    b.quaternion.copy(d.idleQuat);
    bones.set(d.name, b);
    (d.parent ? bones.get(d.parent)! : armature).add(b);
  }
  // head_end のような Rig 外の骨
  const extra = new Bone();
  extra.name = 'head_end';
  extra.position.set(0, 2, 0);
  bones.set('head_end', extra);
  bones.get(BONE.head)!.add(extra);

  const trackFor = (q: (name: string) => Quaternion): QuaternionKeyframeTrack[] =>
    src.data.bones.map((d) => {
      const v = q(d.name);
      return new QuaternionKeyframeTrack(`${d.name}.quaternion`, [0, 1], [v.x, v.y, v.z, v.w, v.x, v.y, v.z, v.w]);
    });
  const idle = new AnimationClip('idle', 1, trackFor((n) => src.idleLocal[src.mustIndex(n)]!));
  // 走り: 肘と膝を 70° 曲げる（曲げる軸 = 合成リグが与えた蝶番軸まわり）
  const bend = (n: string, axis: Vector3): Quaternion =>
    src.idleLocal[src.mustIndex(n)]!.clone().multiply(new Quaternion().setFromAxisAngle(axis, opts.bend === false ? 0 : (70 * Math.PI) / 180));
  const h = src.data.hinges;
  const hingeOf: Record<string, Vector3> = { [BONE.foreR]: h.armR.f, [BONE.foreL]: h.armL.f, [BONE.legR]: h.legR.f, [BONE.legL]: h.legL.f };
  const run = new AnimationClip('run', 1, trackFor((n) => (hingeOf[n] ? bend(n, hingeOf[n]) : src.idleLocal[src.mustIndex(n)]!)));
  return { root, clips: new Map([['idle', idle], ['run', run]]), bones, meshes: [] };
}

const GRIP = { posCm: [0, 8, 0] as const, quat: [0, 0, -Math.SQRT1_2, Math.SQRT1_2] as const };
const OPTS = { idleClip: 'idle', hingeClip: 'run', handFinger: [0, 1, 0] as const, grip: GRIP };

describe('captureRig（合成の資産から）', () => {
  const src = makeRig();

  it('骨・基準ポーズ・グリップを m 単位で取り込み、Rig 外の骨を extras に入れる', () => {
    const { rig, extras, report } = captureRig(makeAsset(), OPTS);
    expect(report.unit).toBeCloseTo(0.01, 9);
    expect(rig.unit).toBeCloseTo(0.01, 9);
    expect(rig.names).toEqual(src.names);
    expect(rig.data.hipsPos.distanceTo(src.data.hipsPos)).toBeLessThan(1e-6);
    for (const n of src.names) {
      const i = rig.mustIndex(n);
      if (n !== BONE.hips) expect(rig.pos[i]!.distanceTo(src.pos[i]!)).toBeLessThan(1e-6); // Hips の位置は hipsPos で別に持つ
      expect(Math.abs(rig.idleLocal[i]!.dot(src.idleLocal[i]!))).toBeGreaterThan(0.999999);
    }
    expect(rig.data.grip.pos.distanceTo(new Vector3(0, 0.08, 0))).toBeLessThan(1e-9);
    expect(extras.map((e) => e.name)).toEqual(['head_end']);
  });

  it('走りクリップの曲がったフレームから、肘・膝の蝶番軸を元の軸どおりに復元する', () => {
    const { rig, report } = captureRig(makeAsset(), OPTS);
    for (const k of ['armR', 'armL', 'legR', 'legL'] as const) {
      expect(report.hinge[k].frames, k).toBeGreaterThan(0);
      expect(report.hinge[k].spreadDeg, k).toBeLessThan(0.5);
      // 向きは曲げる向き（cross(上腕, 前腕)）で決まる。軸としては元と平行
      expect(Math.abs(rig.data.hinges[k].u.dot(src.data.hinges[k].u)), `${k}.u`).toBeGreaterThan(0.9999);
      expect(Math.abs(rig.data.hinges[k].f.dot(src.data.hinges[k].f)), `${k}.f`).toBeGreaterThan(0.9999);
    }
  });

  it('肘膝が曲がらないクリップでは較正できないと分かる', () => {
    expect(() => captureRig(makeAsset({ bend: false }), OPTS)).toThrow(/曲がる/);
  });

  it('Armature が回転している資産は手付けの前提（identity）に合わないので拒否する', () => {
    expect(() => captureRig(makeAsset({ armatureYawDeg: 90 }), OPTS)).toThrow(/identity/);
  });
});
