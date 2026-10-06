import type { WeaponId } from './loadouts';

/**
 * スキル（ADR-031。設計は docs/07-progression-and-world.md）の数値。
 * アクティブスキル「剣技」= 1 回の入力で決まった順に技が自動で続く。**専用の新しいモーション**（SKILL_ATTACKS。src/combat/data/skill-attacks.ts）を中心に、
 * 既存の技（ATTACKS）を連なりの途中に混ぜてもよい。どの段も、前の段の受付時点（AttackDef.cancelAt）の姿勢から続く（クリップの continueFrom。テストで保証する）。
 * 多段ヒット（AttackDef.windows）・スーパーアーマー（AttackDef.armor）・回避でのキャンセル（AttackDef.dodgeCancelAt）は攻撃の定義側にある。無敵はつかない。
 * コストはクールダウン（スキルごと）。レベル 1〜SKILL_LEVEL_MAX: 威力・クールダウンが良くなり、連なりが伸びる（minLevel の段が解放される）。
 */

export type SkillId =
  | 'yotsuba'
  | 'samidare'
  | 'tatsumaki'
  | 'iai'
  | 'juji'
  | 'hayate'
  | 'houzan'
  | 'issen'
  | 'ouzu'
  | 'kenzan'
  | 'hiryu'
  // 杖の魔法（ADR-048）。画面に並列のボタンで並べる。魔法を放った瞬間からクールダウン
  | 'thunder'
  | 'blizzard'
  | 'flame'
  | 'explosion'
  | 'regen'
  | 'hurricane';

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
  iai: {
    id: 'iai',
    name: '居合',
    short: '居合',
    detail: '納刀の構えで溜め、一瞬で踏み込んで左から抜き打ち、返しで斬り上げる。溜めの間はスーパーアーマー',
    family: 'sword',
    steps: [{ attack: 'skIai', evolve: [{ minLevel: 4, attack: 'skIai4' }, { minLevel: 7, attack: 'skIai7' }] }],
    evolutions: [
      { level: 4, text: '斬り上げのあと、左上から右下へ袈裟に斬り下ろす「二ノ太刀」が加わる' },
      { level: 7, text: 'さらに右腰へ引き絞って突き込む「三ノ太刀」が加わる（4 連）' },
    ],
    power: 1.2,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 720,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  juji: {
    id: 'juji',
    name: '十字斬り',
    short: '十字',
    detail: '縦に斬り下ろし、横に薙ぎ、交点へ突き立てて衝撃を爆ぜさせる。最後の突き立ては円の範囲で重い',
    family: 'sword',
    steps: [{ attack: 'skCross', evolve: [{ minLevel: 4, attack: 'skCross2' }, { minLevel: 7, attack: 'skCross3' }] }],
    evolutions: [
      { level: 4, text: '十字が 2 回続く（二重十字。突き立てが 2 回爆ぜる）' },
      { level: 7, text: '十字が 3 回続く（三重十字。突き立てが 3 回爆ぜる）' },
    ],
    power: 1.15,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 600,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  hayate: {
    id: 'hayate',
    name: '疾風連斬',
    short: '疾風',
    detail: '前へ駆けながら、横薙ぎを左右に切り返して斬り抜ける。距離を詰めながら敵を抜ける 4 連。最後の 1 太刀は重い',
    family: 'sword',
    steps: [{ attack: 'skGale', evolve: [{ minLevel: 4, attack: 'skGale6' }, { minLevel: 7, attack: 'skGale8' }] }],
    evolutions: [
      { level: 4, text: '斬り抜けが 4 連から 6 連になる（駆ける距離も伸びる）' },
      { level: 7, text: '8 連になる。最後の 1 太刀は飛ばす力が強い' },
    ],
    power: 1.15,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 570,
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
  ouzu: {
    id: 'ouzu',
    name: '大渦',
    short: '大渦',
    detail: '腰を落として全方位を薙ぐ大回転。前・後ろ・前・後ろと 4 回薙ぎ、回っているあいだはスーパーアーマー',
    family: 'greatsword',
    steps: [{ attack: 'skOuzu', evolve: [{ minLevel: 4, attack: 'skOuzu3' }, { minLevel: 7, attack: 'skOuzu4' }] }],
    evolutions: [
      { level: 4, text: '2 周から 3 周になり、6 回薙ぐ。回りながら前へ追う距離も伸びる' },
      { level: 7, text: '4 周になり、8 回薙ぐ。最後の 1 回は強く飛ばす' },
    ],
    power: 1.2,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 840,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  kenzan: {
    id: 'kenzan',
    name: '剣山',
    short: '剣山',
    detail: '頭上から剣を地面へ突き立て、突き立てた点から衝撃の輪が内から外へ 3 回広がる。突き立てているあいだはスーパーアーマー',
    family: 'greatsword',
    steps: [{ attack: 'skKenzan', evolve: [{ minLevel: 4, attack: 'skKenzan4' }, { minLevel: 7, attack: 'skKenzan5' }] }],
    evolutions: [
      { level: 4, text: '衝撃の輪が 4 回になる（外側の輪はさらに広い）' },
      { level: 7, text: '衝撃の輪が 5 回になる。いちばん外の輪は遠くまで届く' },
    ],
    power: 1.2,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 1020,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  hiryu: {
    id: 'hiryu',
    name: '飛竜落とし',
    short: '飛竜',
    detail: '高く跳び上がり、回りながら降りて叩きつける。降りるまで当たりはなく、着地の衝撃が輪になって広がる。降りてくる間はスーパーアーマー',
    family: 'greatsword',
    steps: [{ attack: 'skHiryu', evolve: [{ minLevel: 4, attack: 'skHiryu4' }, { minLevel: 7, attack: 'skHiryu7' }] }],
    evolutions: [
      { level: 4, text: 'もっと高く跳び、着地の衝撃が 2 重の輪になる' },
      { level: 7, text: '空中で 2 回転する。着地の衝撃が 3 重の輪になり、外側の輪は遠くまで届く' },
    ],
    power: 1.2,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 960,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },

  // ---- 杖（魔法。ADR-048）。1 つの詠唱 = 1 つの魔法（steps は詠唱の攻撃 1 つ）。数値の中身は data/spells.ts、詠唱は data/spell-attacks.ts。
  //      レベルで威力（回復量も）が増え、クールダウンが短くなる（剣技の進化のような動きの変化は無い）。クールダウンは魔法を放った瞬間から数える ----
  thunder: {
    id: 'thunder',
    name: '落雷',
    short: '落雷',
    detail: 'ターゲットとその周囲に雷を落とす（麻痺は後回し）。落ちる前に床へ輪が出る',
    family: 'staff',
    steps: [{ attack: 'spThunder' }],
    power: 1,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 600,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  blizzard: {
    id: 'blizzard',
    name: '吹雪',
    short: '吹雪',
    detail: '前方の扇に吹雪を吹きつけ続ける近距離の魔法（凍結は後回し）',
    family: 'staff',
    steps: [{ attack: 'spBlizzard' }],
    power: 1,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 540,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  flame: {
    id: 'flame',
    name: '火炎放射',
    short: '火炎',
    detail: '前方の直線に炎を放ち続ける。放つあいだは動けないが、向きは変えられる',
    family: 'staff',
    steps: [{ attack: 'spFlame' }],
    power: 1,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 780,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  explosion: {
    id: 'explosion',
    name: '爆発',
    short: '爆発',
    detail: 'ターゲットとその周囲の広い範囲を爆破する。詠唱が長く、威力は最大',
    family: 'staff',
    steps: [{ attack: 'spExplosion' }],
    power: 1,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 1080,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  regen: {
    id: 'regen',
    name: '再生',
    short: '再生',
    detail: '一定時間、体力が少しずつ回復する（INT で回復量が増える）',
    family: 'staff',
    steps: [{ attack: 'spRegen' }],
    power: 1,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 1200,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
  hurricane: {
    id: 'hurricane',
    name: '旋風',
    short: '旋風',
    detail: '自分の周囲に、同心円の暴風を内から外へ巻き起こす。囲まれたときの切り札',
    family: 'staff',
    steps: [{ attack: 'spHurricane' }],
    power: 1,
    powerPerLevel: POWER_PER_LEVEL,
    cooldownFrames: 720,
    cooldownPerLevel: COOLDOWN_PER_LEVEL,
  },
};

/** 一覧に並べる順（系統ごとにまとまる） */
export const SKILL_ORDER: readonly SkillId[] = ['yotsuba', 'samidare', 'tatsumaki', 'iai', 'juji', 'hayate', 'houzan', 'issen', 'ouzu', 'kenzan', 'hiryu', 'thunder', 'blizzard', 'flame', 'explosion', 'regen', 'hurricane'];

export function isSkillId(v: unknown): v is SkillId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SKILLS, v);
}
