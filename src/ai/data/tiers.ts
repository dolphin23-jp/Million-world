/**
 * 敵の段階（Tier。M6-4。ADR-036）。プレイヤーの成長（レベル・ステ振り・スキル）に合わせて、敵が色違いの強化版になって段階的に強くなる。
 * 段 1 = いまの敵そのまま（並）。段 2 以降は同じ敵の「色違い」で、HP・ダメージ・素早さ・予備動作の短さ・体勢の硬さが上がり、経験値・ドロップも増える。
 * 数値はここだけで調整する（実機で見ながら）。変換は enemy-variants.ts の makeVariant（純粋関数）。
 */

export interface TierDef {
  /** 段（1 始まり） */
  tier: number;
  /** 色の名前（敵の名前の頭に付く: 「紅の子鬼」）。段 1 は '' */
  color: string;
  /** 画面に出す名前（「壱 並」など）と、画面に出す短い印（「壱」） */
  name: string;
  mark: string;
  /** 推奨レベル（画面の目安。足りなくても挑める） */
  recommendedLevel: number;
  /** 敵の HP・近接と弾のダメージの倍率 */
  hp: number;
  damage: number;
  /** 移動の速さの倍率 */
  speed: number;
  /** 予備動作の長さ（小さいほど短い = 避ける猶予が減る）・技のあとの待ちの倍率（小さいほど間隔が短い）。予備動作は MIN_WINDUP_FRAMES を下回らない */
  windup: number;
  cooldown: number;
  /** 体勢ゲージの最大・スーパーアーマーを割るダメージの閾値の倍率（プレイヤーが育つほど割りやすくなるので、敵も硬くする） */
  poise: number;
  armor: number;
  /** 倒したときの経験値・ドロップの確率の倍率 */
  xp: number;
  drop: number;
  /** 見た目と当たりの大きさの倍率（色違いの上位種はひと回り大きい） */
  size: number;
  /** リザルトの評価（RANKS の時間・被ダメージの上限）の倍率。敵が硬い・痛いぶん、基準も緩める */
  rankTime: number;
  rankDamage: number;
}

export const TIERS: readonly TierDef[] = [
  { tier: 1, color: '', name: '壱 並', mark: '壱', recommendedLevel: 1, hp: 1, damage: 1, speed: 1, windup: 1, cooldown: 1, poise: 1, armor: 1, xp: 1, drop: 1, size: 1, rankTime: 1, rankDamage: 1 },
  { tier: 2, color: '紅', name: '弐 紅', mark: '弐', recommendedLevel: 8, hp: 1.8, damage: 1.3, speed: 1.06, windup: 0.94, cooldown: 0.9, poise: 1.4, armor: 1.5, xp: 2.2, drop: 1.2, size: 1.05, rankTime: 1.5, rankDamage: 1.3 },
  { tier: 3, color: '蒼', name: '参 蒼', mark: '参', recommendedLevel: 14, hp: 3, damage: 1.65, speed: 1.12, windup: 0.88, cooldown: 0.8, poise: 1.9, armor: 2.2, xp: 4, drop: 1.4, size: 1.1, rankTime: 2.2, rankDamage: 1.65 },
  { tier: 4, color: '黒', name: '肆 黒', mark: '肆', recommendedLevel: 21, hp: 4.6, damage: 2, speed: 1.18, windup: 0.82, cooldown: 0.7, poise: 2.5, armor: 3, xp: 6.5, drop: 1.6, size: 1.15, rankTime: 3, rankDamage: 2 },
];

export const TIER_MAX = TIERS.length;

/** 予備動作の下限（sim フレーム。0.37 秒。段が上がって短くなっても、見て避けられる）。元がこれより短い技は元のまま */
export const MIN_WINDUP_FRAMES = 22;

/** 段（1 始まり）の定義。範囲外は端に丸める */
export function tierDef(tier: number): TierDef {
  const i = Math.min(TIERS.length, Math.max(1, Math.round(Number.isFinite(tier) ? tier : 1)));
  return TIERS[i - 1]!;
}
