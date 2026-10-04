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
  /**
   * 進化（Lv4・Lv7。ADR-034）: この段を、レベルが minLevel 以上なら別の攻撃（attack）に差し替える（同じ段の別の動き。五月雨の突きが 5 → 7 → 9 連になるなど）。
   * 複数あるときは、満たしている中でいちばん高い minLevel のもの。差し替えた攻撃も、前の段の受付時刻の姿勢から続く（クリップの continueFrom）こと
   */
  evolve?: readonly { minLevel: number; attack: string }[];
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
    steps: [
      { attack: 'skQuad1' },
      { attack: 'skQuad2' },
      { attack: 'skQuad3' },
      { attack: 'skQuad4', scale: 1.1 },
      // Lv4: 5 つ目に突き込み（長く突く）/ Lv7: 6 つ目に回し斬り（1 回転して前後を薙ぐ）
      { attack: 'skQuad5', minLevel: 4, scale: 1.15 },
      { attack: 'skQuad6', minLevel: 7, scale: 1.2 },
    ],
    evolutions: [
      { level: 4, text: '5 つ目に「突き込み」が加わる。右足を踏み込んで真っ直ぐ、長く突く' },
      { level: 7, text: '6 つ目に「回し斬り」が加わる。突き込みのあと 1 回転して、前と後ろを薙ぎ払う' },
    ],
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
    steps: [{ attack: 'skFlurry', evolve: [{ minLevel: 4, attack: 'skFlurry7' }, { minLevel: 7, attack: 'skFlurry9' }] }],
    evolutions: [
      { level: 4, text: '突きが 5 連から 7 連になる（間隔も少し詰まる）' },
      { level: 7, text: '突きが 9 連になり、とどめの 9 発目は深く踏み込んで、さらに長く強く突く' },
    ],
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
    steps: [{ attack: 'skWhirl', evolve: [{ minLevel: 4, attack: 'skWhirl35' }, { minLevel: 7, attack: 'skWhirl45' }] }],
    evolutions: [
      { level: 4, text: '2 周半から 3 周半になり、前 4 回・後ろ 3 回当たる。回りながら前へ追う距離も伸びる' },
      { level: 7, text: '4 周半になり、前 5 回・後ろ 4 回当たる（9 ヒット）' },
    ],
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
    steps: [
      { attack: 'skGsSweep1' },
      { attack: 'skGsSweep2' },
      // Lv4: 叩きつけが「飛翔崩山」（跳び込み・衝撃波が 2 重）に替わる / Lv7: 4 つ目に「地裂」（地面をえぐって斬り上げ、長い衝撃）
      { attack: 'skGsSlam', evolve: [{ minLevel: 4, attack: 'skGsSlamLeap' }] },
      { attack: 'skGsRip', minLevel: 7 },
    ],
    evolutions: [
      { level: 4, text: '叩きつけが「飛翔崩山」になる。高く跳び込んで叩きつけ、衝撃波が 2 重に広がる（外側の輪は遠く大きい）' },
      { level: 7, text: '4 つ目に「地裂」が加わる。叩きつけた剣で地面をえぐって斬り上げ、前方へ長い衝撃を走らせる' },
    ],
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
    steps: [
      { attack: 'skGsIssen' },
      // Lv4: 2 つ目に「返し斬り」（振り返りざまに薙ぎ戻す）/ Lv7: 3 つ目に「突き抜け」（体ごと飛び込んで貫く）
      { attack: 'skGsIssen2', minLevel: 4 },
      { attack: 'skGsIssenLunge', minLevel: 7 },
    ],
    evolutions: [
      { level: 4, text: '斬り抜けたあと、振り返りざまに斬る「返し斬り」が続く（返し斬りの間もアーマー）' },
      { level: 7, text: 'さらに「突き抜け」が続く。牛の構えから体ごと飛び込んで、長く重く貫く' },
    ],
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
