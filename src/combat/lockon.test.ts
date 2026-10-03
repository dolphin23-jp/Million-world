import { describe, expect, it } from 'vitest';
import { angleFromCamera, lockStillValid, lockYaw, pickTarget, switchTarget, type LockCandidate } from './lockon';
import { LOCKON } from './data/lockon';
import { wrapAngle } from '../core/math';

/** カメラ yaw = π: プレイヤーの背後（−Z）から +Z を見る。画面の右は −X */
const CAM = Math.PI;
const c = (id: number, x: number, z: number): LockCandidate => ({ id, x, z });

describe('lockYaw / angleFromCamera', () => {
  it('対象の方向を正面に見る yaw（+Z → π、+X → −π/2、−Z → 0、−X → π/2。±π は同じ角度）', () => {
    const same = (a: number, b: number) => expect(Math.abs(wrapAngle(a - b))).toBeLessThan(1e-9);
    same(lockYaw(0, 1), Math.PI);
    same(lockYaw(1, 0), -Math.PI / 2);
    same(lockYaw(0, -1), 0);
    same(lockYaw(-1, 0), Math.PI / 2);
  });

  it('その yaw のカメラから見ると、対象は正面（ずれ 0）', () => {
    for (const [dx, dz] of [[0, 1], [1, 0], [-2, -3], [3, -1]] as const) {
      expect(angleFromCamera(lockYaw(dx, dz), dx, dz)).toBeCloseTo(0, 9);
    }
  });

  it('画面の右にいる敵は正、左は負（yaw = π のとき右は −X）', () => {
    expect(angleFromCamera(CAM, -1, 1)).toBeGreaterThan(0);
    expect(angleFromCamera(CAM, 1, 1)).toBeLessThan(0);
    expect(angleFromCamera(CAM, -1, 0)).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('pickTarget', () => {
  it('maxRange 以内で最寄りの敵を選ぶ', () => {
    expect(pickTarget(0, 0, CAM, [c(1, 0, 6), c(2, 0, 3), c(3, 0, 9)])).toBe(2);
  });

  it('同じくらいの距離なら、画面の正面に近い敵を優先する', () => {
    // 正面の敵（z = 5）と、真横の敵（x = −4.6、距離はわずかに近い）
    expect(pickTarget(0, 0, CAM, [c(1, -4.6, 0), c(2, 0, 5)])).toBe(2);
  });

  it('範囲外しかいなければ null', () => {
    expect(pickTarget(0, 0, CAM, [c(1, 0, LOCKON.maxRange + 1)])).toBeNull();
    expect(pickTarget(0, 0, CAM, [])).toBeNull();
  });
});

describe('switchTarget', () => {
  // プレイヤーは原点。いまの対象は正面（+Z）。右（−X 側）に 1 体、左（+X 側）に 1 体
  const cands = [c(1, 0, 6), c(2, -4, 5), c(3, 4, 5)];

  it('右へ切り替えると、画面の右隣の敵へ移る', () => {
    expect(switchTarget(1, 1, 0, 0, cands)).toBe(2);
  });

  it('左へ切り替えると、画面の左隣の敵へ移る', () => {
    expect(switchTarget(1, -1, 0, 0, cands)).toBe(3);
  });

  it('その向きに敵がいなければ今のまま（右端の敵から右へ、左端の敵から左へ）', () => {
    expect(switchTarget(2, 1, 0, 0, cands)).toBe(2);
    expect(switchTarget(3, -1, 0, 0, cands)).toBe(3);
    expect(switchTarget(2, 1, 0, 0, [c(2, -4, 5)])).toBe(2);
  });

  it('端の敵から逆向きに切り替えると正面の敵へ戻る', () => {
    expect(switchTarget(2, -1, 0, 0, cands)).toBe(1);
    expect(switchTarget(3, 1, 0, 0, cands)).toBe(1);
  });

  it('近い角度の敵を先に選ぶ（右へ 2 回で一番右まで）', () => {
    const row = [c(1, 0, 6), c(2, -2, 6), c(3, -5, 4)];
    const first = switchTarget(1, 1, 0, 0, row);
    expect(first).toBe(2);
    expect(switchTarget(first, 1, 0, 0, row)).toBe(3);
  });

  it('角度が同じなら近い敵', () => {
    const same = [c(1, 0, 6), c(2, -3, 3), c(3, -6, 6)]; // 2 と 3 はどちらもいまの対象から 45° の向き
    expect(switchTarget(1, 1, 0, 0, same)).toBe(2);
  });

  it('いまの対象がいない（倒れた）なら、そのまま返す', () => {
    expect(switchTarget(99, 1, 0, 0, cands)).toBe(99);
  });

  it('maxRange の外の敵へは切り替えない', () => {
    expect(switchTarget(1, 1, 0, 0, [c(1, 0, 6), c(2, -3, LOCKON.maxRange + 5)])).toBe(1);
  });
});

describe('lockStillValid', () => {
  it('breakRange 以内なら続ける。遠すぎる・いなければ解除', () => {
    expect(lockStillValid(0, 0, c(1, 0, LOCKON.breakRange - 1))).toBe(true);
    expect(lockStillValid(0, 0, c(1, 0, LOCKON.breakRange + 1))).toBe(false);
    expect(lockStillValid(0, 0, undefined)).toBe(false);
  });
});
