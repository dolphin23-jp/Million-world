import type { AuthoredKey, Ease } from '../authoring';

/**
 * 体の部位を時間差で動かす（腰 → 胸 → 腕・剣の順に遅れて動く）。
 *
 * 力は足から腰、胸、腕、剣の順に伝わるので、腰の回転が先に終わり、胸、腕、剣が少しずつ遅れて終わる。
 * 全部が同じ瞬間に動くと、体が一枚の板のように回って見え、斬りに「しなり」が出ない（実機の違和感の一因）。
 * ここでは、腕・剣のキーを基準の時刻 t に置き、腰の回転は t − LEAD.hips、胸と頭は t − LEAD.chest に置く。
 * 腰の移動（y・z。沈み込みと前傾）は足の着地に合わせたいので基準の時刻に置く。
 *
 * 前の技の受付時点の姿勢（continueFrom の起点）は、先行させた分だけ早く出来上がるので、つなぎ目の姿勢は変わらない
 * （腕・剣のキーを受付時刻に置き、先行は常に「早める」向きにしかかけない）。
 */
export const LEAD = { hips: 0.03, chest: 0.015 } as const;

export type Pose = Pick<AuthoredKey, 'hips' | 'chest' | 'head' | 'grip' | 'blade' | 'face' | 'roll' | 'pole' | 'left' | 'leftPole'>;

/** pose を 1〜4 本のキーに分けて返す（キーの配列に `...pose(...)` で展開して使う） */
export function pose(t: number, ease: Ease, p: Pose, lead: { hips: number; chest: number } = LEAD): AuthoredKey[] {
  const keys: AuthoredKey[] = [];
  const { hips, chest, head, ...arm } = p;
  if (hips) {
    const rot: NonNullable<AuthoredKey['hips']> = {};
    const move: NonNullable<AuthoredKey['hips']> = {};
    if (hips.yaw !== undefined) rot.yaw = hips.yaw;
    if (hips.pitch !== undefined) rot.pitch = hips.pitch;
    if (hips.roll !== undefined) rot.roll = hips.roll;
    if (hips.x !== undefined) move.x = hips.x;
    if (hips.y !== undefined) move.y = hips.y;
    if (hips.z !== undefined) move.z = hips.z;
    if (Object.keys(rot).length > 0) keys.push({ t: t - lead.hips, ease, hips: rot });
    if (Object.keys(move).length > 0) keys.push({ t, ease, hips: move });
  }
  if (chest || head) {
    const k: AuthoredKey = { t: t - lead.chest, ease };
    if (chest) k.chest = chest;
    if (head) k.head = head;
    keys.push(k);
  }
  if (Object.keys(arm).length > 0) keys.push({ t, ease, ...arm });
  return keys;
}
