import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { mirrorGrip, type HandFrame } from './mirror-grip';

const v = (x: number, y: number, z: number) => new Vector3(x, y, z).normalize();
const near = (a: Vector3, b: Vector3, eps = 1e-6) => expect(a.distanceTo(b)).toBeLessThan(eps);

/** 右手の座標系（f = 指、t = 親指側、d = 手の甲側 = f × t。hero.glb の右手に近い値） */
function rightFrame(): HandFrame {
  const f = v(0.18, 0.95, -0.27);
  const t0 = v(-0.65, 0.32, 0.69);
  const d = new Vector3().crossVectors(f, t0).normalize();
  const t = new Vector3().crossVectors(d, f).normalize();
  return { center: new Vector3(-0.0074, 0.0936, -0.0177), f, t, d };
}
/** 左手の座標系 = 右手を x の反転で写したもの（手系は逆。d は手の甲側 = −f × t） */
function leftFrameExactMirror(r: HandFrame, rotateDeg = 0): HandFrame {
  const m = (a: Vector3) => new Vector3(-a.x, a.y, a.z);
  const f = m(r.f);
  const t = m(r.t);
  const d = new Vector3().crossVectors(f, t).negate().normalize();
  const fr: HandFrame = { center: m(r.center), f, t, d };
  if (rotateDeg !== 0) {
    // 左手の形が鏡像からずれている場合（指の向きが手の甲の法線まわりに回っている）
    const q = new Quaternion().setFromAxisAngle(d, (rotateDeg * Math.PI) / 180);
    fr.f = f.clone().applyQuaternion(q);
    fr.t = t.clone().applyQuaternion(q);
  }
  return fr;
}

describe('mirrorGrip（左手の握り = 右手の握りの鏡像）', () => {
  const right = rightFrame();
  const gripQ = new Quaternion(0.0883, 0.3901, 0.2744, 0.8745).normalize();
  const grip = { pos: new Vector3(-0.0086, 0.0748, -0.0122), quat: gripQ };

  it('左手が右手の厳密な鏡像なら、握りの位置・刃の向きも x を反転した鏡像になる', () => {
    const left = leftFrameExactMirror(right);
    const m = mirrorGrip(right, left, grip);
    const mirror = (a: Vector3) => new Vector3(-a.x, a.y, a.z);
    near(m.pos, mirror(grip.pos));
    // 刃（剣の +Y）の向き
    near(new Vector3(0, 1, 0).applyQuaternion(m.quat), mirror(new Vector3(0, 1, 0).applyQuaternion(grip.quat)));
    // 面の法線（剣の +Z）は反転する（右手と左手が柄の反対側から握る）
    near(new Vector3(0, 0, 1).applyQuaternion(m.quat), mirror(new Vector3(0, 0, 1).applyQuaternion(grip.quat)).negate());
    // 回転になっている（単位クォータニオン）
    expect(m.quat.length()).toBeCloseTo(1, 9);
  });

  it('左手の形が鏡像からずれていても、握りと手の座標系の関係は右手と同じ（刃と指・親指・手の甲のなす角が等しい）', () => {
    for (const deg of [0, 17, -25]) {
      const left = leftFrameExactMirror(right, deg);
      const m = mirrorGrip(right, left, grip);
      const bR = new Vector3(0, 1, 0).applyQuaternion(grip.quat);
      const bL = new Vector3(0, 1, 0).applyQuaternion(m.quat);
      expect(bL.dot(left.f)).toBeCloseTo(bR.dot(right.f), 6);
      expect(bL.dot(left.t)).toBeCloseTo(bR.dot(right.t), 6);
      expect(bL.dot(left.d)).toBeCloseTo(bR.dot(right.d), 6);
      // 手のひらの中心（握りの位置）の、手の座標系での成分（center から）も同じ
      const pR = grip.pos.clone().sub(right.center);
      const pL = m.pos.clone().sub(left.center);
      expect(pL.dot(left.f)).toBeCloseTo(pR.dot(right.f), 6);
      expect(pL.dot(left.t)).toBeCloseTo(pR.dot(right.t), 6);
      expect(pL.dot(left.d)).toBeCloseTo(pR.dot(right.d), 6);
    }
  });

  it('剣の座標系の 3 軸が互いに直交し、右手系（回転）になっている', () => {
    const left = leftFrameExactMirror(right, 17);
    const m = mirrorGrip(right, left, grip);
    const x = new Vector3(1, 0, 0).applyQuaternion(m.quat);
    const y = new Vector3(0, 1, 0).applyQuaternion(m.quat);
    const z = new Vector3(0, 0, 1).applyQuaternion(m.quat);
    expect(x.dot(y)).toBeCloseTo(0, 9);
    expect(y.dot(z)).toBeCloseTo(0, 9);
    near(new Vector3().crossVectors(x, y), z, 1e-9);
  });

  it('指の向きも写す（診断用）', () => {
    const left = leftFrameExactMirror(right, 17);
    const m = mirrorGrip(right, left, grip, right.f);
    near(m.finger!, left.f);
    expect(mirrorGrip(right, left, grip).finger).toBeNull();
  });
});
