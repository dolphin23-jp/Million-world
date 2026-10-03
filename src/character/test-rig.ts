import { Quaternion, Vector3 } from 'three';
import { BONE, Rig, type BoneDesc, type RigData } from './rig';
import type { PoseInput, PoseOutput } from './pose-solver';

/** テスト用の合成リグと FK（pose-solver.test.ts / authoring.test.ts 共用） */

/** 腕を下ろした合成リグ（Meshy と同じ規約: 骨のローカル +Y が子へ向かう）。単位 m */
export function makeRig(): Rig {
  const q = (axis: 'x' | 'y' | 'z', deg: number) => new Quaternion().setFromAxisAngle(new Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), (deg * Math.PI) / 180);
  const I = () => new Quaternion();
  const b = (name: string, parent: string | null, pos: [number, number, number], idleQuat: Quaternion): BoneDesc => ({ name, parent, pos: new Vector3(...pos), idleQuat });
  const bones: BoneDesc[] = [
    b(BONE.hips, null, [0, 0, 0], I()),
    b(BONE.spine02, BONE.hips, [0, 0.1, 0], I()),
    b(BONE.spine01, BONE.spine02, [0, 0.1, 0], I()),
    b(BONE.spine, BONE.spine01, [0, 0.1, 0], I()),
    b(BONE.neck, BONE.spine, [0, 0.07, 0], I()),
    b(BONE.head, BONE.neck, [0, 0.1, 0], I()),
    // 右: 鎖骨は −X へ、腕は下へ
    b(BONE.shoulderR, BONE.spine, [-0.03, 0.04, 0], q('z', 90)),
    b(BONE.armR, BONE.shoulderR, [0, 0.1, 0], q('z', 90)),
    b(BONE.foreR, BONE.armR, [0, 0.23, 0], I()),
    b(BONE.handR, BONE.foreR, [0, 0.21, 0], I()),
    b(BONE.shoulderL, BONE.spine, [0.03, 0.04, 0], q('z', -90)),
    b(BONE.armL, BONE.shoulderL, [0, 0.1, 0], q('z', -90)),
    b(BONE.foreL, BONE.armL, [0, 0.23, 0], I()),
    b(BONE.handL, BONE.foreL, [0, 0.21, 0], I()),
    // 脚: 腰から下へ。足は前（+Z）へ向く
    b(BONE.upLegR, BONE.hips, [-0.09, -0.05, 0], q('x', 180)),
    b(BONE.legR, BONE.upLegR, [0, 0.4, 0], I()),
    b(BONE.footR, BONE.legR, [0, 0.4, 0], q('x', -90)),
    b(BONE.toeR, BONE.footR, [0, 0.15, 0], I()),
    b(BONE.upLegL, BONE.hips, [0.09, -0.05, 0], q('x', 180)),
    b(BONE.legL, BONE.upLegL, [0, 0.4, 0], I()),
    b(BONE.footL, BONE.legL, [0, 0.4, 0], q('x', -90)),
    b(BONE.toeL, BONE.footL, [0, 0.15, 0], I()),
  ];
  // 蝶番軸: 前方（+Z）へ曲げる肘・膝の世界軸 +X を、各骨のローカルへ写したもの
  const world = new Vector3(1, 0, 0);
  const rig0 = new Rig({ bones, hipsPos: new Vector3(0, 0.95, 0), hinges: dummyHinges(), grip: { pos: new Vector3(0, 0.08, 0), quat: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2) } });
  const hinge = (bone: string): Vector3 => world.clone().applyQuaternion(rig0.idleWorldQ[rig0.mustIndex(bone)]!.clone().invert());
  const data: RigData = {
    bones,
    hipsPos: new Vector3(0, 0.95, 0),
    hinges: {
      armR: { u: hinge(BONE.armR), f: hinge(BONE.foreR) },
      armL: { u: hinge(BONE.armL), f: hinge(BONE.foreL) },
      legR: { u: hinge(BONE.upLegR), f: hinge(BONE.legR) },
      legL: { u: hinge(BONE.upLegL), f: hinge(BONE.legL) },
    },
    grip: { pos: new Vector3(0, 0.08, 0), quat: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2) },
  };
  return new Rig(data);
}
function dummyHinges(): RigData['hinges'] {
  const h = () => ({ u: new Vector3(1, 0, 0), f: new Vector3(1, 0, 0) });
  return { armR: h(), armL: h(), legR: h(), legL: h() };
}

export function zeroInput(): PoseInput {
  const z = () => ({ yaw: 0, pitch: 0, roll: 0 });
  const foot = () => ({ x: 0, z: 0, lift: 0, yaw: 0, pitch: 0 });
  return {
    rootZ: 0,
    hips: { ...z(), x: 0, y: 0, z: 0 },
    chest: z(),
    head: z(),
    grip: { az: 0.2, el: 0.1, r: 0.42 },
    blade: new Vector3(0, 0.3, 1),
    face: new Vector3(-1, 0, 0),
    pole: new Vector3(-1, -1, 0),
    left: { az: -0.3, el: -0.3, r: 0.35 },
    leftPole: new Vector3(1, -1, 0),
    footL: foot(),
    footR: foot(),
  };
}

/** 出力の親ローカル回転から世界の回転・位置を再構成する（FK） */
export function fk(rig: Rig, out: PoseOutput, rootZ: number) {
  const Q: Quaternion[] = [];
  const P: Vector3[] = [];
  rig.names.forEach((_, i) => {
    const p = rig.parent[i]!;
    if (p < 0) {
      Q.push(out.quats[i]!.clone());
      P.push(out.hipsPos.clone().add(new Vector3(0, 0, rootZ)));
    } else {
      Q.push(Q[p]!.clone().multiply(out.quats[i]!));
      P.push(P[p]!.clone().add(rig.pos[i]!.clone().applyQuaternion(Q[p]!)));
    }
  });
  const at = (n: string) => ({ q: Q[rig.mustIndex(n)]!, p: P[rig.mustIndex(n)]! });
  return { at };
}
