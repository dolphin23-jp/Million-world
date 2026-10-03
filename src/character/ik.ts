import { Matrix4, Quaternion, Vector3 } from 'three';

/**
 * 手付けアニメ用の純粋な数学部品（IK・座標系の組み立て）。THREE のベクトル/クォータニオンだけに依存し、
 * シーングラフには触れない。vitest で検証する（ik.test.ts）。
 *
 * 規約: 骨のローカル +Y は子の関節へ向かう（このリグはすべてそうなっている）。
 * 肘・膝は「蝶番」とみなし、曲がる面の法線（蝶番軸）を世界座標で決めてから、骨のローカル蝶番軸をそこへ合わせる。
 */

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _m1 = new Matrix4();
const _m2 = new Matrix4();

export interface TwoBoneResult {
  /** 到達できなかった（目標が遠すぎ・近すぎて、手首位置を寄せた） */
  clamped: boolean;
  /** 肘（膝）が曲がる面の法線。bend = pole 側へ曲げたとき cross(上腕, 前腕) が向く向き */
  hinge: Vector3;
}

/**
 * 2 本の骨（長さ l1: 根元→肘、l2: 肘→手首）の関節位置を求める。
 * pole は肘が向かうべき方向のヒント（世界座標）。outElbow / outWrist に結果を書く。
 * 腕が伸び切っても蝶番軸が定まるよう、軸は pole から作る（外積の 0 割れを避ける）。
 */
export function solveTwoBone(
  root: Vector3,
  target: Vector3,
  l1: number,
  l2: number,
  pole: Vector3,
  outElbow: Vector3,
  outWrist: Vector3,
  outHinge: Vector3 = new Vector3(),
): TwoBoneResult {
  const d = _a.subVectors(target, root);
  let dist = d.length();
  if (dist < 1e-6) {
    d.set(0, -1, 0);
    dist = 1e-6;
  } else {
    d.multiplyScalar(1 / dist);
  }
  const dmin = Math.abs(l1 - l2) + 1e-4;
  const dmax = l1 + l2 - 1e-4;
  const clamped = dist < dmin || dist > dmax;
  const D = Math.min(dmax, Math.max(dmin, dist));
  outWrist.copy(root).addScaledVector(d, D);

  // pole の d に垂直な成分
  const p = _b.copy(pole);
  p.addScaledVector(d, -p.dot(d));
  if (p.lengthSq() < 1e-8) {
    // pole が d と平行: d に垂直な任意の向きで代用
    p.set(0, 0, 1);
    p.addScaledVector(d, -p.dot(d));
    if (p.lengthSq() < 1e-8) {
      p.set(1, 0, 0);
      p.addScaledVector(d, -p.dot(d));
    }
  }
  p.normalize();

  const a = (l1 * l1 - l2 * l2 + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  outElbow.copy(root).addScaledVector(d, a).addScaledVector(p, h);
  // cross(上腕, 前腕) = -h·D·(d × p) → 蝶番軸 = p × d
  outHinge.crossVectors(p, d).normalize();
  return { clamped, hinge: outHinge };
}

/**
 * 局所軸 (yLocal, hLocal) を世界軸 (yWorld, hWorld) へ写す回転を作る。どちらも単位ベクトルで、
 * 組の内部で直交している必要がある（呼び出し側で保証する）。第 3 軸は y × h。
 */
export function frameRotation(yLocal: Vector3, hLocal: Vector3, yWorld: Vector3, hWorld: Vector3, out: Quaternion): Quaternion {
  _c.crossVectors(yLocal, hLocal);
  _m1.makeBasis(yLocal, hLocal, _c); // 列 = (y, h, y×h) のローカル基底
  const L = _m1.clone();
  _c.crossVectors(yWorld, hWorld);
  _m2.makeBasis(yWorld, hWorld, _c);
  // R = W · Lᵀ
  const R = _m2.clone().multiply(L.transpose());
  return out.setFromRotationMatrix(R).normalize();
}

/** q を axis まわりの回転（twist）とそれ以外（swing）に分ける。q = swing · twist */
export function swingTwist(q: Quaternion, axis: Vector3, outSwing: Quaternion, outTwist: Quaternion): void {
  const p = _a.set(q.x, q.y, q.z).projectOnVector(axis);
  outTwist.set(p.x, p.y, p.z, q.w);
  const len = Math.sqrt(outTwist.x ** 2 + outTwist.y ** 2 + outTwist.z ** 2 + outTwist.w ** 2);
  if (len < 1e-8) outTwist.identity();
  else outTwist.set(outTwist.x / len, outTwist.y / len, outTwist.z / len, outTwist.w / len);
  outSwing.copy(q).multiply(_tmpQ.copy(outTwist).invert());
}
const _tmpQ = new Quaternion();

/** 刃の向き blade と、刃の面の法線のヒント face から、剣の回転（ローカル +Y = 刃, +Z = 面の法線, +X = 刃 × 法線）を作る */
export function swordRotation(blade: Vector3, face: Vector3, out: Quaternion): Quaternion {
  const y = _a.copy(blade).normalize();
  const z = _b.copy(face);
  z.addScaledVector(y, -z.dot(y));
  if (z.lengthSq() < 1e-8) {
    z.set(0, 0, 1);
    z.addScaledVector(y, -z.dot(y));
    if (z.lengthSq() < 1e-8) {
      z.set(1, 0, 0);
      z.addScaledVector(y, -z.dot(y));
    }
  }
  z.normalize();
  const x = _c.crossVectors(y, z);
  _m1.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m1).normalize();
}

/**
 * 極座標（キャラ基準）からベクトルへ。az は正面(+Z)から右(−X)へ測る方位、el は水平からの仰角（ラジアン）、r は距離。
 * キャラは +Z を向き、右手側が −X。
 */
export function polarToVector(az: number, el: number, r: number, out: Vector3): Vector3 {
  const ce = Math.cos(el);
  return out.set(-Math.sin(az) * ce * r, Math.sin(el) * r, Math.cos(az) * ce * r);
}

export function vectorToPolar(v: Vector3): { az: number; el: number; r: number } {
  const r = v.length();
  if (r < 1e-9) return { az: 0, el: 0, r: 0 };
  return { az: Math.atan2(-v.x, v.z), el: Math.asin(Math.max(-1, Math.min(1, v.y / r))), r };
}

/** yaw（右へ回る正）・pitch（前傾が正）・roll（右へ傾く正）のラジアンから、キャラ基準（+Z 前、+Y 上、−X 右）の回転を作る */
export function eulerYPR(yaw: number, pitch: number, roll: number, out: Quaternion): Quaternion {
  // 右へ回る = +Y まわりの負の回転（+Z → −X が右）
  const qy = _q1.setFromAxisAngle(_Y, -yaw);
  const qp = _q2.setFromAxisAngle(_X, pitch); // +X まわりの正で +Y が +Z へ倒れる（前傾）
  const qr = _q3.setFromAxisAngle(_Z, roll); // +Z まわりの正で +Y が −X へ倒れる（右へ傾く）
  return out.copy(qy).multiply(qp).multiply(qr);
}
const _Y = new Vector3(0, 1, 0);
const _X = new Vector3(1, 0, 0);
const _Z = new Vector3(0, 0, 1);
const _q1 = new Quaternion();
const _q2 = new Quaternion();
const _q3 = new Quaternion();
