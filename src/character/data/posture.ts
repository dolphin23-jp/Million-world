import type { PostureShare } from '../posture';

/**
 * 立ち姿の前傾（ADR-024）。資産の待機は上体が後ろへ反っている（腰 → 首が −7°。手付けの攻撃もこの基準で作ってある）ので、
 * 立っているあいだだけ、実行時に体幹を前へ傾ける（src/character/posture.ts）。攻撃・回避・走り・空中・着地は傾けない
 * （攻撃は振りの高さ・剣先の床までの距離を詰めてあり、走りは Meshy の走りがすでに前傾 24°）。
 */

/** 腰から首までの線の傾きが、与えた角度にほぼ等しくなる配分（足の付け根は世界の向きのまま。頭は傾き切らせず、視線が下を向きすぎない） */
export const POSTURE_SHARE: PostureShare = { hips: 0.5, spine02: 0.9, spine01: 1.2, spine: 1.4, neck: 1.0, head: 0.5 };

/** 状態ごとの前傾（度。腰 → 首の線を前へ倒す量）。大剣は構えの姿勢（GS_READY）がもともと少し前傾なので、その分を差し引く */
export const POSTURE_LEAN = {
  sword: { idle: 12, guard: 8, charge: 0, run: 0, attack: 0, dodge: 0, hit: 0, dead: 0, air: 0, land: 0, traverse: 0 },
  greatsword: { idle: 12, guard: 8, charge: 0, run: 0, attack: 0, dodge: 0, hit: 0, dead: 0, air: 0, land: 0, traverse: 0 },
  // 槍: 構えの姿勢（SP_READY）がもともと少し前傾なので、大剣と同じ。ガード（横に構える）は少しだけ
  spear: { idle: 12, guard: 6, charge: 0, run: 0, attack: 0, dodge: 0, hit: 0, dead: 0, air: 0, land: 0, traverse: 0 },
  // 杖: 背筋を伸ばした静かな立ち姿（待機の前傾は小さめ。ガード・溜めは無い）
  staff: { idle: 6, guard: 0, charge: 0, run: 0, attack: 0, dodge: 0, hit: 0, dead: 0, air: 0, land: 0, traverse: 0 },
} as const;

/** 傾きを出し入れする速さ（度/秒）。攻撃・回避に入るときは速く（動きの邪魔をしない）、戻るときはゆっくり */
export const POSTURE_SPEED = { toward: 60, away: 110 } as const;
