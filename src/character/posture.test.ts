import { describe, expect, it } from 'vitest';
import { Bone, Euler, Quaternion, Vector3, type Object3D } from 'three';
import { PostureTrim, type PostureBones, type PostureShare } from './posture';

/** Armature（回転なし）の下に、腰 → 胸の鎖と両足の付け根を置いた合成の骨。各骨のローカル回転は少しずつ違う向きにしておく */
function makeBones(): { root: Bone; b: PostureBones } {
  const mk = (name: string, pos: [number, number, number], e: [number, number, number]): Bone => {
    const bone = new Bone();
    bone.name = name;
    bone.position.set(...pos);
    bone.quaternion.setFromEuler(new Euler(...e));
    return bone;
  };
  const root = mk('root', [0, 0, 0], [0, 0, 0]);
  const hips = mk('hips', [0, 1, 0], [0.05, -0.3, 0.02]);
  const spine02 = mk('spine02', [0, 0.1, 0], [-0.1, 0.1, 0]);
  const spine01 = mk('spine01', [0, 0.1, 0], [0.03, 0.2, 0.02]);
  const spine = mk('spine', [0, 0.1, 0], [0.05, -0.1, 0]);
  const neck = mk('neck', [0, 0.07, 0], [0.17, 0.05, 0]);
  const head = mk('head', [0, 0.1, 0], [-0.2, 0, 0.1]);
  const upLegL = mk('upLegL', [0.09, -0.05, 0], [Math.PI - 0.1, 0, 0.05]);
  const upLegR = mk('upLegR', [-0.09, -0.05, 0], [Math.PI + 0.2, 0.1, 0]);
  root.add(hips);
  hips.add(spine02, upLegL, upLegR);
  spine02.add(spine01);
  spine01.add(spine);
  spine.add(neck);
  neck.add(head);
  root.updateMatrixWorld(true);
  return { root, b: { hips, spine02, spine01, spine, neck, head, upLegL, upLegR } };
}

const SHARE: PostureShare = { hips: 0.5, spine02: 0.9, spine01: 1.2, spine: 1.4, neck: 1.0, head: 0.5 };
const worldQ = (o: Object3D): Quaternion => o.getWorldQuaternion(new Quaternion());
const worldP = (o: Object3D): Vector3 => o.getWorldPosition(new Vector3());
const deg = (r: number) => (r * 180) / Math.PI;
/** 補正前後の世界の回転の差（補正後 × 補正前⁻¹）が、X 軸まわり何度か（軸のずれも返す） */
function delta(before: Quaternion, after: Quaternion): { angle: number; offAxis: number } {
  const d = after.clone().multiply(before.clone().invert());
  const w = Math.min(1, Math.abs(d.w));
  const angle = 2 * Math.acos(w) * Math.sign(d.x === 0 ? 1 : d.x * Math.sign(d.w));
  const offAxis = Math.hypot(d.y, d.z);
  return { angle: deg(angle), offAxis };
}

describe('PostureTrim（前傾補正）', () => {
  it('各骨の世界の回転が、share × 傾き だけ X 軸まわり（前傾）に回る。足の付け根は世界の向きのまま', () => {
    const { root, b } = makeBones();
    const names = ['hips', 'spine02', 'spine01', 'spine', 'neck', 'head'] as const;
    const before = Object.fromEntries([...names, 'upLegL', 'upLegR'].map((n) => [n, worldQ(b[n as keyof PostureBones])]));
    const trim = new PostureTrim(b, SHARE);
    trim.apply(12);
    root.updateMatrixWorld(true);
    for (const n of names) {
      const d = delta(before[n]!, worldQ(b[n]));
      expect(d.angle).toBeCloseTo(SHARE[n] * 12, 3);
      expect(d.offAxis).toBeLessThan(1e-6);
    }
    for (const n of ['upLegL', 'upLegR'] as const) {
      expect(Math.abs(delta(before[n]!, worldQ(b[n])).angle)).toBeLessThan(1e-3);
    }
  });

  it('腰の位置は動かず、腰から首までの線が前（+Z）へ傾く', () => {
    const { root, b } = makeBones();
    const lean = (): number => {
      const d = worldP(b.neck).sub(worldP(b.hips));
      return deg(Math.atan2(d.z, d.y));
    };
    const hips0 = worldP(b.hips);
    const lean0 = lean();
    new PostureTrim(b, SHARE).apply(12);
    root.updateMatrixWorld(true);
    expect(worldP(b.hips).distanceTo(hips0)).toBeLessThan(1e-9);
    // 腰から首までの線の傾きは、与えた角度にほぼ等しい（share の配分の設計）
    expect(lean() - lean0).toBeGreaterThan(10);
    expect(lean() - lean0).toBeLessThan(14);
  });

  it('release() で元の値へ戻り、傾き 0 の補正は何も変えない', () => {
    const { root, b } = makeBones();
    const all = [b.hips, b.spine02, b.spine01, b.spine, b.neck, b.head, b.upLegL, b.upLegR];
    const before = all.map((o) => o.quaternion.clone());
    const trim = new PostureTrim(b, SHARE);
    trim.apply(15);
    expect(all.some((o, i) => o.quaternion.angleTo(before[i]!) > 1e-3)).toBe(true);
    trim.release();
    for (let i = 0; i < all.length; i++) expect(all[i]!.quaternion.angleTo(before[i]!)).toBeLessThan(1e-6);
    trim.apply(0);
    root.updateMatrixWorld(true);
    for (let i = 0; i < all.length; i++) expect(all[i]!.quaternion.angleTo(before[i]!)).toBeLessThan(1e-6);
  });

  it('毎フレームの release → apply で補正が重ならない（ミキサーが書き直さない場合も）', () => {
    const { b } = makeBones();
    const trim = new PostureTrim(b, SHARE);
    trim.release();
    trim.apply(12);
    const once = b.head.quaternion.clone();
    for (let i = 0; i < 5; i++) {
      trim.release(); // ミキサーが値を書かなかったので、骨には前回の補正済みの値が残っている → 先に戻す
      trim.apply(12);
    }
    expect(b.head.quaternion.angleTo(once)).toBeLessThan(1e-6);
  });
});
