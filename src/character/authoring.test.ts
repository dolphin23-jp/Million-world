import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { AuthoredSampler, bakeAttack, type AuthoredAttack } from './authoring';
import { swordRotation } from './ik';
import { BONE } from './rig';
import { makeRig } from './test-rig';

const DEG = Math.PI / 180;
const rig = makeRig();

function sampleAt(def: AuthoredAttack, t: number) {
  const s = new AuthoredSampler(rig, def);
  return s.sample(t, s.newInput());
}

describe('AuthoredSampler', () => {
  it('キーが無いチャンネルは idle のまま', () => {
    const def: AuthoredAttack = { name: 't', duration: 1, keys: [{ t: 0.5, chest: { yaw: 20 } }] };
    const s = new AuthoredSampler(rig, def);
    const base = s.newInput();
    const p = s.sample(0.7, s.newInput());
    expect(p.grip.az).toBeCloseTo(base.grip.az, 9);
    expect(p.grip.el).toBeCloseTo(base.grip.el, 9);
    expect(p.grip.r).toBeCloseTo(base.grip.r, 9);
    expect(p.left.az).toBeCloseTo(base.left.az, 9);
    expect(p.blade.distanceTo(base.blade)).toBeLessThan(1e-6);
    expect(p.pole.distanceTo(base.pole)).toBeLessThan(1e-9);
  });

  it('最初のキーが t>0 なら t=0 は idle（0）で、キーの値へ補間する。角度は度で書く', () => {
    const def: AuthoredAttack = { name: 't', duration: 1, keys: [{ t: 0.4, ease: 'lin', chest: { yaw: 30 }, hips: { x: 0.1 } }] };
    expect(sampleAt(def, 0).chest.yaw).toBe(0);
    expect(sampleAt(def, 0.2).chest.yaw).toBeCloseTo(15 * DEG, 9);
    expect(sampleAt(def, 0.4).chest.yaw).toBeCloseTo(30 * DEG, 9);
    expect(sampleAt(def, 0.9).chest.yaw).toBeCloseTo(30 * DEG, 9); // 最後のキーで保持
    expect(sampleAt(def, 0.2).hips.x).toBeCloseTo(0.05, 9); // 位置は m のまま
  });

  it('grip は [方位°, 仰角°, 距離] で書け、"idle" は idle の値（ラジアン）に戻る', () => {
    const def: AuthoredAttack = {
      name: 't',
      duration: 1,
      keys: [
        { t: 0, grip: 'idle' },
        { t: 0.5, ease: 'lin', grip: [40, 60, 0.5] },
        { t: 1, ease: 'lin', grip: 'idle' },
      ],
    };
    const base = new AuthoredSampler(rig, def).newInput();
    const a = sampleAt(def, 0);
    expect(a.grip.az).toBeCloseTo(base.grip.az, 9);
    expect(a.grip.el).toBeCloseTo(base.grip.el, 9);
    const m = sampleAt(def, 0.5);
    expect(m.grip.az).toBeCloseTo(40 * DEG, 9);
    expect(m.grip.el).toBeCloseTo(60 * DEG, 9);
    expect(m.grip.r).toBeCloseTo(0.5, 9);
    const e = sampleAt(def, 1);
    expect(e.grip.az).toBeCloseTo(base.grip.az, 9);
    expect(e.grip.r).toBeCloseTo(base.grip.r, 9);
  });

  it('t=0 のパディングも idle の値（ラジアン）で入る（度とラジアンの混在がない）', () => {
    const def: AuthoredAttack = { name: 't', duration: 1, keys: [{ t: 0.5, ease: 'lin', grip: [10, 10, 0.4] }] };
    const base = new AuthoredSampler(rig, def).newInput();
    expect(sampleAt(def, 0).grip.az).toBeCloseTo(base.grip.az, 9);
    expect(sampleAt(def, 0).grip.el).toBeCloseTo(base.grip.el, 9);
  });

  it('剣の向きはキー間を slerp で補間し、中間の角度が等分になる', () => {
    const def: AuthoredAttack = { name: 't', duration: 1, keys: [{ t: 1, ease: 'lin', blade: [0, 0.6, 0.8], face: [1, 0, 0] }] };
    const s = new AuthoredSampler(rig, def);
    const sword = (t: number) => {
      const p = s.sample(t, s.newInput());
      return swordRotation(p.blade, p.face, new Quaternion());
    };
    const total = sword(0).angleTo(sword(1));
    expect(total).toBeGreaterThan(0.5);
    expect(sword(0).angleTo(sword(0.5))).toBeCloseTo(total / 2, 4);
    expect(sword(0.5).angleTo(sword(1))).toBeCloseTo(total / 2, 4);
  });

  it('rootZ のカーブと、足の弧（arc）の持ち上げ', () => {
    const def: AuthoredAttack = {
      name: 't',
      duration: 1,
      keys: [
        { t: 0.5, ease: 'lin', rootZ: 0.3, footL: { z: 0.4, arc: 0.1 } },
        { t: 1, ease: 'lin', rootZ: 0.3 },
      ],
    };
    const s = new AuthoredSampler(rig, def);
    expect(s.rootZ(0.25)).toBeCloseTo(0.15, 9);
    expect(s.rootZ(0.8)).toBeCloseTo(0.3, 9);
    const mid = s.sample(0.25, s.newInput());
    expect(mid.footL.lift).toBeCloseTo(0.1, 6); // 区間の中点で弧の頂点
    expect(mid.footL.z).toBeCloseTo(0.2, 9);
    expect(s.sample(0.5, s.newInput()).footL.lift).toBeCloseTo(0, 6);
    expect(s.sample(0.75, s.newInput()).footL.lift).toBeCloseTo(0, 9);
  });

  it('z キー無しで arc だけ書いた足（x だけ動く）でも NaN が混ざらない', () => {
    const def: AuthoredAttack = { name: 't', duration: 1, keys: [{ t: 0.5, ease: 'lin', footR: { x: 0.2, arc: 0.05 } }] };
    for (const t of [0, 0.1, 0.25, 0.5, 0.9]) {
      const p = sampleAt(def, t);
      expect(Number.isFinite(p.footR.x)).toBe(true);
      expect(Number.isFinite(p.footR.z)).toBe(true);
      expect(Number.isFinite(p.footR.lift)).toBe(true);
    }
    expect(sampleAt(def, 0.25).footR.lift).toBeCloseTo(0.05, 6);
  });
});

describe('bakeAttack', () => {
  it('何も動かさない攻撃は idle のポーズ（全ボーンが idle の回転、剣の位置のずれなし）に焼ける', () => {
    const def: AuthoredAttack = { name: 'still', duration: 0.5, keys: [] };
    const { clip, stats } = bakeAttack(rig, def, 60);
    expect(stats.frames).toBe(31);
    expect(stats.maxGripError).toBeLessThan(1e-4);
    expect(clip.duration).toBeCloseTo(0.5, 9);
    // 腕脚は直線のリグでは肘膝の向き（骨軸まわりのねじれ）が不定なので、ここでは体幹だけ見る（先端の位置は pose-solver.test.ts）
    for (const n of [BONE.hips, BONE.spine02, BONE.spine, BONE.neck, BONE.head]) {
      const tr = clip.tracks.find((t) => t.name === `${n}.quaternion`)!;
      const v = tr.values;
      const last = new Quaternion(v[v.length - 4], v[v.length - 3], v[v.length - 2], v[v.length - 1]);
      expect(Math.abs(last.dot(rig.idleLocal[rig.mustIndex(n)]!))).toBeGreaterThan(0.9999);
    }
    const hp = clip.tracks.find((t) => t.name === `${BONE.hips}.position`)!;
    expect(hp.values[1]!).toBeCloseTo(rig.data.hipsPos.y * 100, 0); // 脚が真っすぐな合成リグでは安全マージン分（数 mm）下がる
  });

  it('クォータニオンは前フレームと符号がそろい、動く攻撃でも柄の位置誤差が小さい', () => {
    const def: AuthoredAttack = {
      name: 'swing',
      duration: 0.6,
      keys: [
        { t: 0.2, ease: 'io', chest: { yaw: -25, pitch: 5 }, grip: [-20, 70, 0.28], blade: [0.2, 0.9, -0.4] },
        { t: 0.4, ease: 'in', chest: { yaw: 35, pitch: 15 }, grip: [30, 10, 0.32], blade: [-0.6, 0.2, 0.8], rootZ: 0.25 },
        { t: 0.6, ease: 'out', grip: 'idle', blade: 'idle', chest: { yaw: 0, pitch: 0 }, rootZ: 0.25 },
      ],
    };
    const { clip, stats } = bakeAttack(rig, def, 60);
    // 合成リグは idle で腕が伸び切っているので、端のフレームは「届く限界」で数 mm 以内の誤差になる
    expect(stats.maxGripError).toBeLessThan(1e-3);
    for (const tr of clip.tracks) {
      if (!tr.name.endsWith('.quaternion')) continue;
      const v = tr.values;
      for (let f = 1; f < v.length / 4; f++) {
        const d = v[f * 4]! * v[f * 4 - 4]! + v[f * 4 + 1]! * v[f * 4 - 3]! + v[f * 4 + 2]! * v[f * 4 - 2]! + v[f * 4 + 3]! * v[f * 4 - 1]!;
        expect(d).toBeGreaterThan(0);
      }
    }
    const last = (n: string) => {
      const v = clip.tracks.find((t) => t.name === `${n}.quaternion`)!.values;
      return new Quaternion(v[v.length - 4], v[v.length - 3], v[v.length - 2], v[v.length - 1]);
    };
    // 終端は idle に戻っている（体幹）
    expect(Math.abs(last(BONE.spine).dot(rig.idleLocal[rig.mustIndex(BONE.spine)]!))).toBeGreaterThan(0.9999);
    // Hips の position は root 基準（rootZ を引いてある）なので終端でも idle の高さ・前後
    const hp = clip.tracks.find((t) => t.name === `${BONE.hips}.position`)!.values;
    const n = hp.length / 3;
    expect(hp[(n - 1) * 3 + 2]!).toBeCloseTo(new Vector3().copy(rig.data.hipsPos).z * 100, 1);
  });
});
