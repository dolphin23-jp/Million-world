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

describe('continueFrom（コンボの連鎖）', () => {
  const first: AuthoredAttack = {
    name: 'first',
    duration: 0.6,
    keys: [
      { t: 0.3, ease: 'io', rootZ: 0.3, hips: { yaw: -14, pitch: 6, y: -0.05 }, chest: { yaw: -26, pitch: 12 }, head: { yaw: -8 }, grip: [-34, -18, 0.3], blade: [0.3, -0.5, 0.8], face: [0.6, 0.5, 0], pole: [-0.5, -0.8, 0], left: [-75, -15, 0.3], footL: { z: 0.3, arc: 0.1 } },
      { t: 0.6, ease: 'io', footR: { z: 0.3, arc: 0.07 } },
    ],
  };
  const T0 = 0.4;
  const second: AuthoredAttack = {
    name: 'second',
    duration: 0.5,
    continueFrom: { attack: first, t: T0 },
    keys: [{ t: 0.3, ease: 'io', rootZ: 0.24, chest: { yaw: 28 }, footR: { z: 0.2 } }],
  };

  it('t=0 のポーズが前の技の時刻 t のポーズに一致する（足と原点だけ付け替わる）', () => {
    const a = new AuthoredSampler(rig, first);
    const b = new AuthoredSampler(rig, second);
    const pa = a.sample(T0, a.newInput());
    const pb = b.sample(0, b.newInput());
    const r0 = a.rootZ(T0);
    expect(r0).toBeGreaterThan(0.1);
    expect(pb.rootZ).toBe(0);
    for (const g of ['hips', 'chest', 'head'] as const) {
      expect(pb[g].yaw).toBeCloseTo(pa[g].yaw, 9);
      expect(pb[g].pitch).toBeCloseTo(pa[g].pitch, 9);
    }
    expect(pb.hips.y).toBeCloseTo(pa.hips.y, 9);
    expect(pb.grip.az).toBeCloseTo(pa.grip.az, 9);
    expect(pb.grip.el).toBeCloseTo(pa.grip.el, 9);
    expect(pb.grip.r).toBeCloseTo(pa.grip.r, 9);
    expect(pb.left.az).toBeCloseTo(pa.left.az, 9);
    expect(pb.blade.distanceTo(pa.blade)).toBeLessThan(1e-9);
    expect(pb.face.distanceTo(pa.face)).toBeLessThan(1e-9);
    expect(pb.pole.distanceTo(pa.pole)).toBeLessThan(1e-9);
    for (const f of ['footL', 'footR'] as const) {
      expect(pb[f].z).toBeCloseTo(pa[f].z - r0, 9); // 世界での足の位置（z + ルート原点）は同じ
      expect(pb[f].lift).toBeCloseTo(pa[f].lift, 9);
    }
  });

  it('キーが無いチャンネルは idle ではなく前の技の姿勢を保ち、"idle" と書けば本当の idle になる', () => {
    const a = new AuthoredSampler(rig, first);
    const pa = a.sample(T0, a.newInput());
    const b = new AuthoredSampler(rig, second);
    const late = b.sample(0.45, b.newInput());
    expect(late.head.yaw).toBeCloseTo(pa.head.yaw, 9);
    expect(late.grip.az).toBeCloseTo(pa.grip.az, 9);
    expect(late.chest.yaw).toBeCloseTo(28 * DEG, 9); // キーのあるチャンネルは新しい値へ
    const idle = a.newInput();
    const back: AuthoredAttack = { ...second, keys: [...second.keys, { t: 0.5, ease: 'lin', grip: 'idle', blade: 'idle', left: 'idle' }] };
    const c = new AuthoredSampler(rig, back);
    const end = c.sample(0.5, c.newInput());
    expect(end.grip.az).toBeCloseTo(idle.grip.az, 9);
    expect(end.left.r).toBeCloseTo(idle.left.r, 9);
    expect(end.blade.distanceTo(idle.blade)).toBeLessThan(1e-6);
  });

  it('足の弧の途中から始めても、持ち上げ量がつながる', () => {
    const mid = 0.45; // footR が弧の途中
    const a = new AuthoredSampler(rig, first);
    expect(a.sample(mid, a.newInput()).footR.lift).toBeGreaterThan(0.01);
    const b = new AuthoredSampler(rig, { name: 'x', duration: 0.3, keys: [], continueFrom: { attack: first, t: mid } });
    expect(b.sample(0, b.newInput()).footR.lift).toBeCloseTo(a.sample(mid, a.newInput()).footR.lift, 9);
  });

  it('三段の連鎖（さらに前の技の原点が付け替わっていても、世界での足の位置が保たれる）', () => {
    const t1 = 0.3;
    const third: AuthoredAttack = { name: 'third', duration: 0.5, continueFrom: { attack: second, t: t1 }, keys: [{ t: 0.3, ease: 'io', rootZ: 0.4, footL: { z: 0.4 } }] };
    const b = new AuthoredSampler(rig, second);
    const pb = b.sample(t1, b.newInput());
    const rb = b.rootZ(t1);
    expect(rb).toBeCloseTo(0.24, 9);
    const c = new AuthoredSampler(rig, third);
    const pc = c.sample(0, c.newInput());
    expect(pc.rootZ).toBe(0);
    expect(pc.chest.yaw).toBeCloseTo(28 * DEG, 9);
    expect(pc.footR.z).toBeCloseTo(pb.footR.z - rb, 9);
    expect(pc.footL.z).toBeCloseTo(pb.footL.z - rb, 9);
    // 二段目の footL は一段目の足位置（0.3 − 0.3）を引き継いで、二段目の原点基準では −r0
    const a = new AuthoredSampler(rig, first);
    expect(pb.footL.z).toBeCloseTo(a.sample(T0, a.newInput()).footL.z - a.rootZ(T0), 9);
  });

  it('焼いた最初のフレームが、前の技の同じ時刻のフレームと一致する（体幹・腕・Hips の高さ）', () => {
    const A = bakeAttack(rig, first, 60);
    const B = bakeAttack(rig, second, 60);
    const f0 = Math.round(T0 * 60);
    for (const n of rig.names) {
      const va = A.clip.tracks.find((t) => t.name === `${n}.quaternion`)!.values;
      const vb = B.clip.tracks.find((t) => t.name === `${n}.quaternion`)!.values;
      const qa = new Quaternion(va[f0 * 4], va[f0 * 4 + 1], va[f0 * 4 + 2], va[f0 * 4 + 3]);
      const qb = new Quaternion(vb[0], vb[1], vb[2], vb[3]);
      expect(Math.abs(qa.dot(qb)), n).toBeGreaterThan(1 - 1e-6); // Float32 に焼いてある
    }
    const ha = A.clip.tracks.find((t) => t.name === `${BONE.hips}.position`)!.values;
    const hb = B.clip.tracks.find((t) => t.name === `${BONE.hips}.position`)!.values;
    for (let k = 0; k < 3; k++) expect(hb[k]!).toBeCloseTo(ha[f0 * 3 + k]!, 6);
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
