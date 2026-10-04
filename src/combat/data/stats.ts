/**
 * ステータス（M6-2。ADR-033。設計は docs/07 §3.2）。STR / DEX / AGI / INT / VIT。初期値は各 5。
 * 1 ポイントの効きは小さく（1% 前後）、振った点の合計が STAT_SOFT_CAP を超えた分は効きが半分になる（逓減）。
 * 効きの数値はここだけに集める。戦闘のコードは数値を Modifiers（src/combat/modifiers.ts）からだけ読む。
 */
export type StatId = 'str' | 'dex' | 'agi' | 'int' | 'vit';

export const STAT_IDS: readonly StatId[] = ['str', 'dex', 'agi', 'int', 'vit'];

/** 初期値（レベル 1・振っていない状態） */
export const STAT_BASE = 5;

/** 1 つのステータスに振った点（値 − STAT_BASE）がこれを超えた分は、効きが STAT_OVER_RATE 倍になる */
export const STAT_SOFT_CAP = 30;
export const STAT_OVER_RATE = 0.5;

/** 振った点 x（0 以上）の、効きに使う点（逓減を掛けたもの） */
export function effectivePoints(x: number): number {
  const p = Math.max(0, x);
  return p <= STAT_SOFT_CAP ? p : STAT_SOFT_CAP + (p - STAT_SOFT_CAP) * STAT_OVER_RATE;
}

export interface StatInfo {
  /** 画面に出す名前と、ひとこと */
  name: string;
  short: string;
  detail: string;
}

export const STAT_INFO: Record<StatId, StatInfo> = {
  str: { name: '力', short: 'STR', detail: '攻撃のダメージ・ノックバック' },
  dex: { name: '器用', short: 'DEX', detail: '攻撃の速さ・パリィの受付・会心率と会心ダメージ' },
  agi: { name: '敏捷', short: 'AGI', detail: '移動の速さ・回避の無敵・ミスティカルの長さ' },
  int: { name: '知力', short: 'INT', detail: 'スキルのクールダウンと威力・薬瓶の回復' },
  vit: { name: '体力', short: 'VIT', detail: '最大体力・受けるダメージの軽減' },
};

/** 効きの数値（効きに使う点 1 あたり）。下限・上限は computeModifiers が守る */
export const STAT_EFFECTS = {
  /** STR: ダメージ +1.0% / ノックバック +0.5% */
  str: { damage: 0.01, knockback: 0.005 },
  /** DEX: 攻撃の速さ +0.5%（モーションの倍率）/ パリィの受付 10 点で +1 フレーム / 会心率 +0.5%（初期 5%。CRIT）/ 会心ダメージ +1.5%（初期 ×1.5） */
  dex: { attackSpeed: 0.005, parryFramesPer: 0.1, critRate: 0.005, critDamage: 0.015 },
  /** AGI: 移動 +0.6% / 回避の無敵 8 点で +1 フレーム / ミスティカルの長さ 1 点で +3 フレーム（0.05 秒） */
  agi: { moveSpeed: 0.006, dodgeInvulnFramesPer: 0.125, mysticalFramesPer: 3 },
  /** INT: スキルのクールダウン −0.8%（下限 0.5 倍）/ スキルの威力 +0.6% / 薬瓶の回復 +1% */
  int: { skillCooldown: 0.008, skillCooldownFloor: 0.5, skillPower: 0.006, heal: 0.01 },
  /** VIT: 最大体力 +2 / 受けるダメージ −0.3%（VIT だけでは下限 0.7 倍。パッシブの鉄壁を重ねても全体で 0.5 倍まで = damageTakenTotalFloor） */
  vit: { maxHp: 2, damageTaken: 0.003, damageTakenFloor: 0.7, damageTakenTotalFloor: 0.5 },
} as const;
