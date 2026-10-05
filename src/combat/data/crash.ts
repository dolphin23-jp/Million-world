import type { ParryEffectDef } from './guard';

/**
 * 突進の激突（M7-4c。ADR-045）の数値。手触りの調整はここだけを触る。
 *
 * 突進（EnemyAttackDef.crash を持つ攻撃。暴れ猪）が踏み込みのあいだに障害物（体を止める柱・岩・壁・箱）にぶつかると、
 * 自分にダメージを受け（最大 HP の damageRatio。倒れはしない）、体勢を崩して動けなくなる（反撃の窓）。
 * 柱の前に立って突進を誘い、ぎりぎりで避ければ、猪が柱に激突して大きな隙を見せる。
 */
export const CRASH = {
  /** 激突で受けるダメージ（最大 HP の割合）。HP は 1 までしか減らない（激突で倒れて撃破扱い・経験値の混乱が起きないように） */
  damageRatio: 0.2,
  /** 踏み込みの 1 ステップの進む距離に、これだけ足した先まで障害物が来ていたら、ぶつかったとする（m。押し出される前にぶつかりを捉える余裕） */
  margin: 0.12,
  /** 激突の動き: 体勢を崩す（stagger）。パリィの stagger と同じ仕組み（動けない frames・反撃の riposteFrames・倍率）。突進の向きと逆へ少し弾かれる */
  effect: {
    id: 'stagger',
    frames: 110,
    riposteFrames: 90,
    enemyKnockback: 1.1,
    knockbackFrames: 10,
    hitStop: 12,
    shake: { amp: 0.12, seconds: 0.34 },
    burst: 1.4,
    labelScale: 1.3,
    sfx: 'groundSmash',
    riposteDamageScale: 1.8,
    riposteKnockbackScale: 0.4,
    recoverCooldownFrames: 40,
  } satisfies ParryEffectDef,
} as const;
