import { Matrix4, Quaternion, Vector3 } from 'three';

/**
 * 左手の握り（両手持ちの大剣。ADR-023）: 右手の握り（HERO.sword）を、左右の鏡像にして左手ボーンのローカルで表す。
 *
 * 手のメッシュは指ボーンが無く、手ボーンに固く付いている。右手は「柄が手のひらを斜めに横切り、刃が親指側から前へ伸びる」位置と向きに調整してあるので、
 * 左手も同じ位置・向きで柄に当てないと、柄が手のひらの外を通る・手の甲を貫く（平手が柄に載って見える）。
 * 手首の位置だけ柄の軸に置いて、手の向きを idle のままにしていた M4-3 の両手持ちは、振りの途中でそうなっていた。
 *
 * 鏡像は、両手のメッシュの座標系（指の向き f・親指側 t・手の甲側 d。tools/measure-hand-axes.mjs で頂点から測る）の対応で作る:
 * 右手の握りを (f, t, d) の成分に分け、左手の (f, t, d) で組み直す。手の形は左右の鏡像だが完全ではなく
 * （左手の指の向きは、右手を骨の向きで鏡に写したものから約 17° 違う）、骨の向きで写すと左手の手のひらに握りが合わない。
 * 左手の座標系は右手の鏡像（手系が逆）なので、そのまま写した剣の座標系（x = 幅、y = 刃、z = 面の法線）は左手系になる。
 * 法線（z）を反転して回転にする: 右手と左手が柄の反対側から握る（手の甲が外を向き、両方の親指が刃のほうを向く。両手持ちの自然な握り）。
 * 柄は円柱なので、刃の面の向きには影響しない。
 */

/** 手のメッシュの座標系（手ボーンのローカル）。center は手のひらの中心あたり（m）、f / t / d は単位ベクトル */
export interface HandFrame {
  center: Vector3;
  f: Vector3;
  t: Vector3;
  d: Vector3;
}

export interface GripFrame {
  /** 手ボーンのローカルでの柄の位置（m） */
  pos: Vector3;
  /** 剣のローカル → 手ボーンのローカルの回転 */
  quat: Quaternion;
}

export interface MirroredGrip extends GripFrame {
  /** 左手の指が向く方向（左手ボーンのローカル、単位ベクトル）。右手の finger の鏡像 */
  finger: Vector3 | null;
}

const _m = new Matrix4();

/** 右手の座標系での成分 → 左手の座標系で組み直したベクトル（向き）。mirrorDir(v) の v は右手ボーンのローカル */
function mirrorDir(v: Vector3, r: HandFrame, l: HandFrame): Vector3 {
  return new Vector3()
    .addScaledVector(l.f, v.dot(r.f))
    .addScaledVector(l.t, v.dot(r.t))
    .addScaledVector(l.d, v.dot(r.d));
}

/**
 * 右手の握り grip（右手ボーンのローカル）から、左手の握りを作る。finger: 右手の指の向き（任意。手首の曲がりの診断用）。
 * 右手の座標系 right と左手の座標系 left が対応する軸（f ↔ f、t ↔ t、d ↔ d）で、左手のほうが手系が逆（det = −1）であること。
 */
export function mirrorGrip(right: HandFrame, left: HandFrame, grip: GripFrame, finger?: Vector3): MirroredGrip {
  const axis = (a: Vector3): Vector3 => a.clone().applyQuaternion(grip.quat);
  const x = mirrorDir(axis(new Vector3(1, 0, 0)), right, left);
  const y = mirrorDir(axis(new Vector3(0, 1, 0)), right, left);
  const z = mirrorDir(axis(new Vector3(0, 0, 1)), right, left).negate();
  _m.makeBasis(x, y, z);
  const quat = new Quaternion().setFromRotationMatrix(_m).normalize();
  const pos = mirrorDir(grip.pos.clone().sub(right.center), right, left).add(left.center);
  return { pos, quat, finger: finger ? mirrorDir(finger, right, left).normalize() : null };
}
