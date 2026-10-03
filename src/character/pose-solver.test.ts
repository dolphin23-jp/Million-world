import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { BONE } from './rig';
import { PoseSolver, createPoseOutput } from './pose-solver';
import { polarToVector, swordRotation } from './ik';
import { fk, makeRig, zeroInput } from './test-rig';

const near = (a: Vector3, b: Vector3, eps = 1e-4) => expect(a.distanceTo(b)).toBeLessThan(eps);

describe('PoseSolver（合成リグ）', () => {
  const rig = makeRig();
  const solver = new PoseSolver(rig);

  it('idle の姿勢（差分ゼロ）では体幹が idle の回転のまま', () => {
    const out = createPoseOutput(rig);
    solver.solve(zeroInput(), out);
    for (const n of [BONE.hips, BONE.spine02, BONE.spine01, BONE.spine, BONE.neck, BONE.head]) {
      const i = rig.mustIndex(n);
      expect(Math.abs(out.quats[i]!.dot(rig.idleLocal[i]!))).toBeGreaterThan(0.99999);
    }
    // 接地した足は idle の足首位置
    const f = fk(rig, out, 0);
    near(f.at(BONE.footL).p, rig.idleWorldP[rig.mustIndex(BONE.footL)]!);
    near(f.at(BONE.footR).p, rig.idleWorldP[rig.mustIndex(BONE.footR)]!);
    expect(out.info.hipsDrop).toBeLessThan(0.005); // 脚が真っすぐな合成リグでは安全マージン分だけ
  });

  it('右手の柄が指定の位置に届き、剣が指定の向きになる（胸をひねっても）', () => {
    const inp = zeroInput();
    inp.chest.yaw = 0.6;
    inp.chest.pitch = 0.2;
    inp.grip = { az: 0.5, el: 0.4, r: 0.3 };
    inp.blade.set(0.3, 0.8, 0.5);
    const out = createPoseOutput(rig);
    solver.solve(inp, out);
    expect(out.info.armRClamped).toBe(false);
    expect(out.info.gripError).toBeLessThan(1e-4);
    const f = fk(rig, out, 0);
    // 柄の世界位置 = 肩 + 胸の座標系の極座標
    const S = f.at(BONE.armR).p;
    const hand = f.at(BONE.handR);
    const G = hand.p.clone().add(rig.data.grip.pos.clone().applyQuaternion(hand.q));
    // 胸の回転は solver と同じ規約で作り直す
    const chestQ = chestQuat(0.6, 0.2, 0);
    near(G, S.clone().add(polarToVector(0.5, 0.4, 0.3, new Vector3()).applyQuaternion(chestQ)), 2e-4);
    // 剣の向き
    const swordQ = hand.q.clone().multiply(rig.data.grip.quat);
    const want = swordRotation(new Vector3(0.3, 0.8, 0.5), inp.face, new Quaternion()).premultiply(chestQ);
    expect(Math.abs(swordQ.dot(want))).toBeGreaterThan(0.9999);
  });

  it('足は世界固定: ルートが前進しても接地した足首は動かない', () => {
    const inp = zeroInput();
    inp.footL = { x: 0, z: 0.4, lift: 0, yaw: 0, pitch: 0 };
    const out = createPoseOutput(rig);
    for (const rootZ of [0, 0.2, 0.4]) {
      inp.rootZ = rootZ;
      inp.hips.z = 0; // 腰はルートに付く
      solver.solve(inp, out);
      const f = fk(rig, out, rootZ);
      const homeL = rig.idleWorldP[rig.mustIndex(BONE.footL)]!;
      const homeR = rig.idleWorldP[rig.mustIndex(BONE.footR)]!;
      near(f.at(BONE.footL).p, new Vector3(homeL.x, homeL.y, homeL.z + 0.4), 2e-3);
      near(f.at(BONE.footR).p, homeR, 2e-3);
    }
  });

  it('足が遠すぎる（腰が高すぎる）と腰を下げて届かせる', () => {
    const inp = zeroInput();
    inp.footL = { x: -0.15, z: 0.55, lift: 0, yaw: 0, pitch: 0 };
    inp.footR = { x: 0.1, z: -0.4, lift: 0, yaw: 0, pitch: 0 };
    const out = createPoseOutput(rig);
    solver.solve(inp, out);
    expect(out.info.hipsDrop).toBeGreaterThan(0.03);
    expect(out.info.legLClamped).toBe(false);
    expect(out.info.legRClamped).toBe(false);
    const f = fk(rig, out, 0);
    const homeL = rig.idleWorldP[rig.mustIndex(BONE.footL)]!;
    near(f.at(BONE.footL).p, new Vector3(homeL.x + 0.15, homeL.y, homeL.z + 0.55), 2e-3);
  });

  it('骨の長さが保たれる（腕・脚）', () => {
    const inp = zeroInput();
    inp.chest.yaw = -0.8;
    inp.footL.lift = 0.15;
    const out = createPoseOutput(rig);
    solver.solve(inp, out);
    const f = fk(rig, out, 0);
    expect(f.at(BONE.foreR).p.distanceTo(f.at(BONE.armR).p)).toBeCloseTo(0.23, 4);
    expect(f.at(BONE.handR).p.distanceTo(f.at(BONE.foreR).p)).toBeCloseTo(0.21, 4);
    expect(f.at(BONE.legL).p.distanceTo(f.at(BONE.upLegL).p)).toBeCloseTo(0.4, 4);
  });
});

function chestQuat(yaw: number, pitch: number, roll: number): Quaternion {
  const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -yaw);
  const qp = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch);
  const qr = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), roll);
  return qy.multiply(qp).multiply(qr);
}
