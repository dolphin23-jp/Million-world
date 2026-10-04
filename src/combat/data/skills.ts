import type { WeaponId } from './loadouts';

/**
 * スキル（ADR-031。設計は docs/07-progression-and-world.md）の数値。
 * アクティブスキル「剣技」= 1 回の入力で決まった順に技が自動で続く。**専用の新しいモーション**（SKILL_ATTACKS。src/combat/data/skill-attacks.ts）を中心に、
 * 既存の技（ATTACKS）を連なりの途中に混ぜてもよい。どの段も、前の段の受付時点（AttackDef.cancelAt）の姿勢から続く（クリップの continueFrom。テストで保証する）。
 * 多段ヒット（AttackDef.windows）・スーパーアーマー（AttackDef.armor）・回避でのキャンセル（AttackDef.dodgeCancelAt）は攻撃の定義側にある。無敵はつかない。
 * コストはクールダウン（スキルごと）。レベル 1〜SKILL_LEVEL_MAX: 威力・クールダウンが良くなり、連なりが伸びる（minLevel の段が解放される）。
 */

export type SkillId = 'yotsuba' | 'samidare' | 'tatsumaki' | 'houzan' | 'issen';

export const SKILL_LEVEL_MAX = 10;

/** 画面に出す進化の説明（どのレベルで何が変わるか） */
export interface SkillEvolutionInfo {
  level: number;
  text: string;
}

export interface SkillStepDef {
  /** 攻撃 id（ATTACKS か SKILL_ATTACKS のキー。findAttack で探す）。前の段の受付時点の姿勢から続くこと（クリップの continueFrom がそうなっているのをテストする） */
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
  /** モーションが進化するレベル（Lv4 と Lv7。M6-3b）と、画面に出す説明。レベルが上がると連なり・動きが変わる（steps の minLevel / evolve） */
  evolutions?: readonly SkillEvolutionInfo[];
  steps: readonly SkillStepDef[];
  /** 威力の倍率（Lv1）と、1 レベルごとの加算。ダメージ・ノックバック・ヒットストップに掛かる（AttackerView.attackPower） */
  power: number;
  powerPerLevel: number;
  /** クールダウン（sim フレーム。Lv1）と、1 レベルごとの短縮の割合 */
  cooldownFrames: number;
  cooldownPerLevel: number;
}

/** レベルごとの数値の伸び（滑らかに。Lv10 で威力 +45%・クールダウン −31.5%）。モーションが変わるのは Lv4 と Lv7（SkillStepDef.evolve。M6-3b） */
const POWER_PER_LEVEL = 0.05;
const COOLDOWN_PER_LEVEL = 0.035;

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
  // ---- 大剣。どれも剣技専用のモーション（SKILL_ATTACKS） ----
  houzan: {
    id: 'houzan',
    name: '崩山',
    short: '崩山',
    detail: '右から払い、左から払い、頭上から地を叩き割る。衝撃波が地面と周囲へ広がる',
    family: 'greatsword',
    steps: [{ attack: 'skGsSweep1' }, { attack: 'skGsSweep2' }, { attack: 'skGsSlam' }],
    power: 1.2,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 900,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  issen: {
    id: 'issen',
    name: '一閃',
    short: '一閃',
    detail: '剣を引いて少し溜め、一瞬で踏み込んで斬り抜ける。前へ長く広い 1 撃。溜めの間はスーパーアーマー',
    family: 'greatsword',
    steps: [{ attack: 'skGsIssen' }],
    power: 1.2,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 780,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
};

/** 一覧に並べる順（系統ごとにまとまる） */
export const SKILL_ORDER: readonly SkillId[] = ['yotsuba', 'samidare', 'tatsumaki', 'houzan', 'issen'];

export function isSkillId(v: unknown): v is SkillId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SKILLS, v);
}
