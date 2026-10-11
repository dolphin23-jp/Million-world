import { TWO_HAND_POLE, type AuthoredAttack, type AuthoredKey, type TwoHand } from '../authoring';

/**
 * 両手持ちの武器（大剣・槍）に共通の、手付けクリップの作り直し。
 * 片手剣のクリップ（ロール・後ろステップ）を、両手持ちの版に置き換える。
 */

type V3 = [number, number, number];

/** 構え（待機・走りの腕。すべての技がここから始まり、ここへ戻る）の値。大剣は GS_READY、槍は SP_READY */
export interface ReadyPose {
  hips: Record<string, number>;
  chest: Record<string, number>;
  head: Record<string, number>;
  grip: V3;
  blade: V3;
  face: V3;
  roll: number;
  pole: V3;
}

/** 両手持ちの武器 1 本ぶんの材料: 左手の握り・構え・構えの終端（クリップの起点） */
export interface TwoHandKit {
  twoHand: TwoHand;
  ready: ReadyPose;
  from: { attack: AuthoredAttack; t: number };
  /** 構えの足の前後のずれ（m。構えのクリップの footL.z / footR.z）。回避の終わりの足の位置にも足して、構えへ戻る（無ければ両足そろえ） */
  feetZ?: { L: number; R: number };
}

/** 動かす値に構えの値を足す（回避の最後のキーは idle = 0 を基準にした値なので、構えの姿勢の値へずらす。360° 回る向きは 360 + 構え） */
function addReady(v: Record<string, number | undefined>, ready: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = x + (ready[k] ?? 0);
  return out;
}

/**
 * 片手剣の回避（ロール・後ろステップ）を、両手持ちの版に作り直す。ルート・足・腰と胸の動きは元のまま（sim の移動と無敵はそのクリップのルートに従うので、
 * rootZ のキーは変えない）。待機の腕（'idle'）は構えの腕に、終わりの腰・胸・頭の姿勢は構えの姿勢に置き換える。
 * 開始は構えから（continueFrom）なので、構えのまま入って、構えのまま終わる（待機 'idle@<武器>' へつなぎ目なく戻れる）。
 */
export function twoHandDodge(src: AuthoredAttack, name: string, kit: TwoHandKit): AuthoredAttack {
  const { ready } = kit;
  const end = src.duration - 1e-6;
  const keys: AuthoredKey[] = src.keys.map((k) => {
    const next: AuthoredKey = { ...k };
    if (k.grip === 'idle') {
      // 待機の腕 → 構えの腕（左手は導かれるので、手付けの left は外す。肘の向きは両手持ちの既定）
      delete next.left;
      next.grip = ready.grip;
      next.blade = ready.blade;
      next.face = ready.face;
      next.roll = ready.roll;
      next.pole = ready.pole;
      next.leftPole = TWO_HAND_POLE;
    }
    if (k.t >= end) {
      if (k.hips) next.hips = addReady(k.hips, ready.hips);
      if (k.chest) next.chest = addReady(k.chest, ready.chest);
      if (k.head) next.head = addReady(k.head, ready.head);
      if (kit.feetZ) {
        if (k.footL?.z !== undefined) next.footL = { ...k.footL, z: k.footL.z + kit.feetZ.L };
        if (k.footR?.z !== undefined) next.footR = { ...k.footR, z: k.footR.z + kit.feetZ.R };
      }
    }
    return next;
  });
  return { name, duration: src.duration, twoHanded: kit.twoHand, continueFrom: kit.from, keys };
}
