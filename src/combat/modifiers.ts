import { CRIT } from './data/crit';
import { STAT_BASE, STAT_EFFECTS, STAT_IDS, effectivePoints, type StatId } from './data/stats';

/**
 * 効果の集計（M6-2。ADR-033。設計は docs/07 §3.3）。ステータス・（将来）パッシブ・武器・装備の効果を **1 か所の純粋関数** に集める。
 * 戦闘のコード（Player・当たり判定・Game）は、数値を Modifiers だけから読む。何かが足されても戦闘のコードは変わらない。
 * 倍率（damage など）は 1 が等倍、加算（maxHp・parryFrames など）は 0 が変化なし。
 */
export interface Modifiers {
  /** 攻撃のダメージの倍率・ノックバックの倍率（STR） */
  damage: number;
  knockback: number;
  /** 攻撃の速さの倍率（DEX。モーションの rate に掛かる。1.1 = 1 割速い） */
  attackSpeed: number;
  /** パリィの受付の加算（フレーム。DEX） */
  parryFrames: number;
  /** 会心率（0..1。1 回の命中ごとに抽選）と会心ダメージの倍率（1.5 = 会心で 1.5 倍。DEX・パッシブ。M6-3。ADR-035） */
  critRate: number;
  critDamage: number;
  /** 移動の速さの倍率（AGI） */
  moveSpeed: number;
  /** 回避の無敵の加算（フレーム。AGI） */
  dodgeInvuln: number;
  /** ミスティカルドッジの続く長さの加算（フレーム。AGI） */
  mysticalFrames: number;
  /** スキルのクールダウンの倍率（小さいほど速い）・スキルの威力の倍率（INT） */
  skillCooldown: number;
  skillPower: number;
  /** 薬瓶の回復量の倍率（INT） */
  heal: number;
  /** 最大体力の加算（VIT） */
  maxHp: number;
  /** 受けるダメージの倍率（小さいほど軽い。VIT） */
  damageTaken: number;
}

/** 何も効いていない状態（レベル 1・振っていない） */
export const BASE_MODIFIERS: Readonly<Modifiers> = {
  damage: 1,
  knockback: 1,
  attackSpeed: 1,
  parryFrames: 0,
  critRate: CRIT.baseRate,
  critDamage: CRIT.baseDamage,
  moveSpeed: 1,
  dodgeInvuln: 0,
  mysticalFrames: 0,
  skillCooldown: 1,
  skillPower: 1,
  heal: 1,
  maxHp: 0,
  damageTaken: 1,
};

export type StatBlock = Readonly<Record<StatId, number>>;

/** 初期値のステータス */
export function baseStats(): Record<StatId, number> {
  return { str: STAT_BASE, dex: STAT_BASE, agi: STAT_BASE, int: STAT_BASE, vit: STAT_BASE };
}

/** ステータスから Modifiers を作る（純粋。パッシブ・装備が入ったら引数を足す） */
export function computeModifiers(stats: StatBlock): Modifiers {
  const p = (id: StatId): number => effectivePoints((stats[id] ?? STAT_BASE) - STAT_BASE);
  const E = STAT_EFFECTS;
  const str = p('str');
  const dex = p('dex');
  const agi = p('agi');
  const int = p('int');
  const vit = p('vit');
  return {
    damage: 1 + E.str.damage * str,
    knockback: 1 + E.str.knockback * str,
    attackSpeed: 1 + E.dex.attackSpeed * dex,
    parryFrames: Math.floor(E.dex.parryFramesPer * dex),
    critRate: Math.min(CRIT.maxRate, Math.max(0, CRIT.baseRate + E.dex.critRate * dex)),
    critDamage: Math.max(CRIT.minDamage, CRIT.baseDamage + E.dex.critDamage * dex),
    moveSpeed: 1 + E.agi.moveSpeed * agi,
    dodgeInvuln: Math.floor(E.agi.dodgeInvulnFramesPer * agi),
    mysticalFrames: Math.round(E.agi.mysticalFramesPer * agi),
    skillCooldown: Math.max(E.int.skillCooldownFloor, 1 - E.int.skillCooldown * int),
    skillPower: 1 + E.int.skillPower * int,
    heal: 1 + E.int.heal * int,
    maxHp: Math.round(E.vit.maxHp * vit),
    damageTaken: Math.max(E.vit.damageTakenFloor, 1 - E.vit.damageTaken * vit),
  };
}

/** 画面に出す、ステータスごとの効果の説明（例: 「ダメージ +12% / ノックバック +6%」）。数値は Modifiers から読む */
export function describeStat(id: StatId, m: Modifiers): string {
  const pct = (x: number): string => `${x >= 1 ? '+' : '−'}${Math.abs(Math.round((x - 1) * 1000) / 10)}%`;
  switch (id) {
    case 'str':
      return `ダメージ ${pct(m.damage)} / ノックバック ${pct(m.knockback)}`;
    case 'dex':
      return `攻撃の速さ ${pct(m.attackSpeed)} / パリィ受付 +${m.parryFrames}f / 会心率 ${(m.critRate * 100).toFixed(1)}% / 会心ダメージ ×${m.critDamage.toFixed(2)}`;
    case 'agi':
      return `移動 ${pct(m.moveSpeed)} / 回避の無敵 +${m.dodgeInvuln}f / ミスティカル +${(m.mysticalFrames / 60).toFixed(2)}秒`;
    case 'int':
      return `スキルのクールダウン ${pct(m.skillCooldown)} / 威力 ${pct(m.skillPower)} / 回復 ${pct(m.heal)}`;
    case 'vit':
      return `最大体力 +${m.maxHp} / 受けるダメージ ${pct(m.damageTaken)}`;
  }
}

/** ステータスの id の列（画面の並び順） */
export const STAT_ORDER = STAT_IDS;
