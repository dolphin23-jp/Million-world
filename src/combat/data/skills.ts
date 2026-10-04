import type { WeaponId } from './loadouts';

/**
 * スキル（ADR-031。設計は docs/07-progression-and-world.md）の数値。
 * アクティブスキル「剣技」= 攻撃（ATTACKS）の連なり。1 回の入力で決まった順に技が自動で続く。新しいモーションは作らず、既存の技のつなぎ
 * （AttackDef.next / branches の辺）に沿った連なりだけを作る（姿勢のつなぎ目が自然で、手付けの工数が要らない。辺であることはテストで保証する）。
 * コストはクールダウン（スキルごと）。レベル 1〜SKILL_LEVEL_MAX: 威力・クールダウンが良くなり、連なりが伸びる（minLevel の段が解放される）。
 */

export type SkillId = 'tsubame' | 'samidare' | 'senpu' | 'shippu' | 'dangan' | 'ouzu' | 'houzan' | 'shoryu';

export const SKILL_LEVEL_MAX = 5;

export interface SkillStepDef {
  /** 攻撃 id（ATTACKS のキー）。前の段の AttackDef.next か branches の辺であること */
  attack: string;
  /** この段が解放されるスキルレベル（省略 = 1）。レベルが上がるほど連なりが伸びる */
  minLevel?: number;
  /** この段の威力の倍率（省略 = 1。とどめの段を強くするなど） */
  scale?: number;
}

export interface SkillDef {
  id: SkillId;
  /** 一覧の名前と、ボタンに出す短い表記（4 文字まで） */
  name: string;
  short: string;
  /** 一行の説明 */
  detail: string;
  /** 使える武器の系統（片手剣・盾付きの片手剣は 'sword'） */
  family: WeaponId;
  steps: readonly SkillStepDef[];
  /** 威力の倍率（Lv1）と、1 レベルごとの加算。ダメージ・ノックバック・ヒットストップに掛かる（AttackerView.attackPower） */
  power: number;
  powerPerLevel: number;
  /** クールダウン（sim フレーム。Lv1）と、1 レベルごとの短縮の割合 */
  cooldownFrames: number;
  cooldownPerLevel: number;
}

const POWER_PER_LEVEL = 0.08;
const COOLDOWN_PER_LEVEL = 0.06;

export const SKILLS: Record<SkillId, SkillDef> = {
  // ---- 片手剣（盾付きも） ----
  tsubame: {
    id: 'tsubame',
    name: '燕返し',
    short: '燕返し',
    detail: '斬って跳び退き、突き込む',
    family: 'sword',
    steps: [{ attack: 'combo1' }, { attack: 'comboHop' }, { attack: 'hopThrust', scale: 1.1 }],
    power: 1.3,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 480,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  samidare: {
    id: 'samidare',
    name: '五月雨',
    short: '五月雨',
    detail: '連なる斬り。レベルで段が伸びる',
    family: 'sword',
    steps: [{ attack: 'combo1' }, { attack: 'combo2' }, { attack: 'combo3' }, { attack: 'comboUpper', minLevel: 3 }, { attack: 'comboSlam', minLevel: 5, scale: 1.1 }],
    power: 1.25,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 720,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  senpu: {
    id: 'senpu',
    name: '旋風',
    short: '旋風',
    detail: '二連の斬りから、体ごと回る',
    family: 'sword',
    steps: [{ attack: 'combo1' }, { attack: 'combo2' }, { attack: 'comboSpin', scale: 1.1 }],
    power: 1.3,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 540,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  shippu: {
    id: 'shippu',
    name: '疾風突き',
    short: '疾風突き',
    detail: '踏み込んで突き、切り返す',
    family: 'sword',
    steps: [{ attack: 'lunge' }, { attack: 'lungeSlash' }],
    power: 1.35,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 360,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  // ---- 大剣 ----
  dangan: {
    id: 'dangan',
    name: '断岩',
    short: '断岩',
    detail: '溜めなしの重い縦斬りと、返しの斬り',
    family: 'greatsword',
    steps: [{ attack: 'gsHeavy' }, { attack: 'gsHeavyRip' }],
    power: 1.15,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 840,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  ouzu: {
    id: 'ouzu',
    name: '大渦',
    short: '大渦',
    detail: '斬ってから、体ごと回って薙ぐ',
    family: 'greatsword',
    steps: [{ attack: 'gs1' }, { attack: 'gsSpin2', scale: 1.1 }],
    power: 1.3,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 600,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  houzan: {
    id: 'houzan',
    name: '崩山',
    short: '崩山',
    detail: '二連の斬りから、地を叩き割る',
    family: 'greatsword',
    steps: [{ attack: 'gs1' }, { attack: 'gs2' }, { attack: 'gsDrop', scale: 1.1 }],
    power: 1.25,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 780,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  shoryu: {
    id: 'shoryu',
    name: '昇竜',
    short: '昇竜',
    detail: '斬り上げ、跳んで叩きつける',
    family: 'greatsword',
    steps: [{ attack: 'gsRise' }, { attack: 'gsRiseSlam', scale: 1.1 }],
    power: 1.3,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 720,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
};

/** 一覧に並べる順（系統ごとにまとまる） */
export const SKILL_ORDER: readonly SkillId[] = ['tsubame', 'samidare', 'senpu', 'shippu', 'dangan', 'ouzu', 'houzan', 'shoryu'];

export function isSkillId(v: unknown): v is SkillId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SKILLS, v);
}
