import type { WeaponId } from './loadouts';

/**
 * スキル（ADR-031。設計は docs/07-progression-and-world.md）の数値。
 * アクティブスキル「剣技」= 攻撃（ATTACKS）の連なり。1 回の入力で決まった順に技が自動で続く。新しいモーションは作らず、既存の技のつなぎ
 * （AttackDef.next / branches の辺）に沿った連なりだけを作る（姿勢のつなぎ目が自然で、手付けの工数が要らない。辺であることはテストで保証する）。
 * コストはクールダウン（スキルごと）。レベル 1〜SKILL_LEVEL_MAX: 威力・クールダウンが良くなり、連なりが伸びる（minLevel の段が解放される）。
 */

export type SkillId = 'yotsuba' | 'samidare' | 'tatsumaki' | 'dangan' | 'ouzu' | 'houzan' | 'shoryu';

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
  // ---- 片手剣（盾付きも）。どれも剣技専用のモーション（SKILL_ATTACKS）。中身は docs/07 §2.1 ----
  yotsuba: {
    id: 'yotsuba',
    name: '四ツ葉',
    short: '四ツ葉',
    detail: '右袈裟・右逆袈裟・左袈裟・左逆袈裟の四連斬り',
    family: 'sword',
    steps: [{ attack: 'skQuad1' }, { attack: 'skQuad2' }, { attack: 'skQuad3' }, { attack: 'skQuad4', scale: 1.1 }],
    power: 1.2,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 540,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  samidare: {
    id: 'samidare',
    name: '五月雨突き',
    short: '五月雨',
    detail: '出の早い高速の突き 5 連。細く前へ長く届く',
    family: 'sword',
    steps: [{ attack: 'skFlurry' }],
    power: 1.15,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 480,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  tatsumaki: {
    id: 'tatsumaki',
    name: '竜巻',
    short: '竜巻',
    detail: '体ごと 2 周半回る。前の半円に 3 回・後ろに 2 回。回っているあいだはスーパーアーマー',
    family: 'sword',
    steps: [{ attack: 'skWhirl' }],
    power: 1.15,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 720,
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
export const SKILL_ORDER: readonly SkillId[] = ['yotsuba', 'samidare', 'tatsumaki', 'dangan', 'ouzu', 'houzan', 'shoryu'];

export function isSkillId(v: unknown): v is SkillId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SKILLS, v);
}
