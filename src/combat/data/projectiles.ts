/**
 * 飛び道具の数値（ADR-026）。時間は sim フレーム（60Hz）、距離は m。
 * 撃つ敵は ENEMIES の attack.projectile で id を指す。当たりは円（半径 radius）で、プレイヤーの円に重なったら命中する。
 */

export interface ProjectileDef {
  id: string;
  /** 飛ぶ速さ（m/s）。プレイヤーの走り（4.8 m/s）より速く、ロール・横への移動で避けられる遅さ */
  speed: number;
  /** 当たりの半径（m） */
  radius: number;
  /** 飛び続けられるフレーム数（超えたら消える。長さ = speed × lifetimeFrames / 60 が予告の帯の長さにもなる） */
  lifetimeFrames: number;
  damage: number;
  /** ノックバック距離（m）とヒットストップ（sim フレーム） */
  knockback: number;
  hitStop: number;
  /** 発射位置: 撃つ敵の中心から向いている方向へ（m） */
  muzzle: number;
  /** パリィで弾き返されたときの飛び方と威力（撃った敵へ向かい、途中の敵に当たる） */
  reflect: { speedScale: number; damage: number; knockback: number; hitStop: number; lifetimeFrames: number };
}

export const PROJECTILES = {
  /**
   * 鬼火（提灯の術師が撃つ）: 9 m/s で一直線に 12.6m 飛ぶ。ダメージは小さい（10）が、近接の敵と同時にさばくのが厄介。
   * ガードで受け止めれば削りだけ、パリィで弾き返すと撃った敵へ飛び返って（1.7 倍の速さ）大きなダメージ（60 = 提灯の HP 以上）。
   */
  wisp: {
    id: 'wisp',
    speed: 9,
    radius: 0.32,
    lifetimeFrames: 84,
    damage: 10,
    knockback: 1.1,
    hitStop: 5,
    muzzle: 0.8,
    reflect: { speedScale: 1.7, damage: 60, knockback: 2.4, hitStop: 10, lifetimeFrames: 90 },
  },
} as const satisfies Record<string, ProjectileDef>;

export type ProjectileId = keyof typeof PROJECTILES;

/** 弾の見た目の高さ（m）。当たりは XZ の円で、高さは描画だけに使う */
export const PROJECTILE_HEIGHT = 1.1;
