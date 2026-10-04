/**
 * パッシブスキル（M6-5。ADR-037。設計は docs/07 §2.2・§2.3）。常時効くスキルで、スキルポイント 1 で 1 レベル上がる（アクティブの剣技と同じポイントを分け合う）。
 * アクティブ（剣技）は最初から Lv1 で使えるが、**パッシブは Lv0（未習得）から始め**、最初の 1 ポイントで習得する（習得制）。
 * 一部には**前提**があり（前提のパッシブが一定のレベルになるまでは習得できない = 小さなツリー）、前提を割るような取り下げはできない。
 * 効果は **Modifiers のキーへの加算**（`effects`。computeModifiers が集計する）。戦闘のコードは Modifiers だけを読む（ADR-033）。
 * 一部のパッシブは武器の系統（family）の装備中だけ効く。イベントで発動する効果（闘気・受け流しの回復）は、Modifiers が値だけを持ち、発動は Game が行う。
 * 数値はここだけで調整する（実機で見ながら）。
 */

import type { WeaponId } from './loadouts';

export type PassiveId =
  | 'swordMastery'
  | 'greatMastery'
  | 'critChance'
  | 'critPower'
  | 'comboArt'
  | 'momentum'
  | 'evasion'
  | 'parryArt'
  | 'followUp'
  | 'agile'
  | 'ironwall'
  | 'apothecary';

/** パッシブが加算できる Modifiers のキー（意味は modifiers.ts）。倍率系は「1 に足す」、フレーム・体力は整数の加算 */
export type PassiveKey =
  | 'damage'
  | 'knockback'
  | 'critRate'
  | 'critDamage'
  | 'comboDamage'
  | 'riposteDamage'
  | 'parryFrames'
  | 'parryHeal'
  | 'dodgeInvuln'
  | 'mysticalFrames'
  | 'moveSpeed'
  | 'damageTaken'
  | 'heal'
  | 'dropRate'
  | 'killBuff';

export type PassiveCategory = 'attack' | 'defense' | 'support';

export interface PassiveEffect {
  key: PassiveKey;
  /** 1 レベルあたりの加算（damageTaken は「軽くする割合」= 正の値で、受けるダメージの倍率から引く） */
  perLevel: number;
}

export interface PassivePrereq {
  id: PassiveId;
  /** 前提のパッシブがこのレベル以上であること */
  level: number;
}

export interface PassiveDef {
  id: PassiveId;
  name: string;
  /** 画面に出すひとこと（効果の数値は effects から自動で出す） */
  detail: string;
  category: PassiveCategory;
  /** 最大レベル（強いものは小さい） */
  levelMax: number;
  /** この系統の武器を装備しているあいだだけ効く（省略 = どの武器でも） */
  family?: WeaponId;
  prereq?: readonly PassivePrereq[];
  effects: readonly PassiveEffect[];
}

export const PASSIVES: Record<PassiveId, PassiveDef> = {
  // ---- 攻め ----
  swordMastery: {
    id: 'swordMastery',
    name: '剣術習熟',
    detail: '片手剣（盾付きも）を構えているあいだ、攻撃のダメージが上がる',
    category: 'attack',
    levelMax: 5,
    family: 'sword',
    effects: [{ key: 'damage', perLevel: 0.04 }],
  },
  greatMastery: {
    id: 'greatMastery',
    name: '剛力習熟',
    detail: '大剣を構えているあいだ、攻撃のダメージとふっ飛ばしが上がる',
    category: 'attack',
    levelMax: 5,
    family: 'greatsword',
    effects: [
      { key: 'damage', perLevel: 0.04 },
      { key: 'knockback', perLevel: 0.03 },
    ],
  },
  critChance: {
    id: 'critChance',
    name: '会心の心得',
    detail: '急所を見抜く。会心が出やすくなる',
    category: 'attack',
    levelMax: 5,
    effects: [{ key: 'critRate', perLevel: 0.02 }],
  },
  critPower: {
    id: 'critPower',
    name: '急所突き',
    detail: '急所を深く突く。会心のダメージが大きくなる',
    category: 'attack',
    levelMax: 3,
    prereq: [{ id: 'critChance', level: 2 }],
    effects: [{ key: 'critDamage', perLevel: 0.1 }],
  },
  comboArt: {
    id: 'comboArt',
    name: '連撃の心得',
    detail: '連携・剣技の 3 発目以降のダメージが上がる',
    category: 'attack',
    levelMax: 5,
    effects: [{ key: 'comboDamage', perLevel: 0.04 }],
  },
  momentum: {
    id: 'momentum',
    name: '闘気',
    detail: '敵を倒すと、しばらく攻撃力が上がる（重なる）',
    category: 'attack',
    levelMax: 3,
    prereq: [{ id: 'comboArt', level: 2 }],
    effects: [{ key: 'killBuff', perLevel: 0.02 }],
  },
  // ---- 守り ----
  evasion: {
    id: 'evasion',
    name: '見切り',
    detail: '回避の無敵が少し長くなり、ミスティカルドッジが長く続く',
    category: 'defense',
    levelMax: 3,
    effects: [
      { key: 'dodgeInvuln', perLevel: 1 },
      { key: 'mysticalFrames', perLevel: 12 },
    ],
  },
  parryArt: {
    id: 'parryArt',
    name: '受け流し',
    detail: 'パリィの受付が広がり、パリィに成功すると体力が回復する',
    category: 'defense',
    levelMax: 5,
    prereq: [{ id: 'evasion', level: 1 }],
    effects: [
      { key: 'parryFrames', perLevel: 1 },
      { key: 'parryHeal', perLevel: 2 },
    ],
  },
  followUp: {
    id: 'followUp',
    name: '追い打ち',
    detail: '弾かれた敵・体勢を崩した敵への攻撃が強くなる',
    category: 'defense',
    levelMax: 3,
    prereq: [{ id: 'parryArt', level: 1 }],
    effects: [{ key: 'riposteDamage', perLevel: 0.06 }],
  },
  agile: {
    id: 'agile',
    name: '身軽',
    detail: '走る速さが上がる',
    category: 'defense',
    levelMax: 5,
    effects: [{ key: 'moveSpeed', perLevel: 0.02 }],
  },
  ironwall: {
    id: 'ironwall',
    name: '鉄壁',
    detail: '受けるダメージが軽くなる',
    category: 'defense',
    levelMax: 5,
    effects: [{ key: 'damageTaken', perLevel: 0.03 }],
  },
  // ---- 補給 ----
  apothecary: {
    id: 'apothecary',
    name: '薬師',
    detail: '薬瓶の回復量が増え、敵が薬瓶を落としやすくなる',
    category: 'support',
    levelMax: 5,
    effects: [
      { key: 'heal', perLevel: 0.1 },
      { key: 'dropRate', perLevel: 0.05 },
    ],
  },
};

/** 一覧に並べる順（カテゴリごとにまとまる。前提のあるものは前提のあと） */
export const PASSIVE_ORDER: readonly PassiveId[] = [
  'swordMastery',
  'greatMastery',
  'critChance',
  'critPower',
  'comboArt',
  'momentum',
  'evasion',
  'parryArt',
  'followUp',
  'agile',
  'ironwall',
  'apothecary',
];

export const PASSIVE_CATEGORY_NAME: Record<PassiveCategory, string> = { attack: '攻め', defense: '守り', support: '補給' };
export const PASSIVE_CATEGORY_ORDER: readonly PassiveCategory[] = ['attack', 'defense', 'support'];

export function isPassiveId(v: unknown): v is PassiveId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PASSIVES, v);
}

/** 闘気（敵を倒すと一定時間、攻撃力が上がる）の数値: 続く長さ（sim フレーム）と、重なる最大の数 */
export const KILL_BUFF = { frames: 240, maxStacks: 5 } as const;

/** パッシブを全部取るのに要るポイント（画面の目安・テスト用） */
export const PASSIVE_POINTS_TOTAL = PASSIVE_ORDER.reduce((n, id) => n + PASSIVES[id].levelMax, 0);

const pct = (x: number): string => `${Math.round(x * 1000) / 10}%`;
const sec = (frames: number): string => `${Math.round((frames / 60) * 100) / 100}秒`;

/** 効果 1 つの画面の文章（lv = 効かせるレベル。例: 「ダメージ +8%」） */
function effectText(e: PassiveEffect, lv: number): string {
  const v = e.perLevel * lv;
  switch (e.key) {
    case 'damage':
      return `ダメージ +${pct(v)}`;
    case 'knockback':
      return `ふっ飛ばし +${pct(v)}`;
    case 'critRate':
      return `会心率 +${pct(v)}`;
    case 'critDamage':
      return `会心ダメージ +${Math.round(v * 100) / 100}`;
    case 'comboDamage':
      return `3 発目以降のダメージ +${pct(v)}`;
    case 'riposteDamage':
      return `反撃のダメージ +${pct(v)}`;
    case 'parryFrames':
      return `パリィ受付 +${Math.round(v)}f`;
    case 'parryHeal':
      return `パリィ成功で体力 +${Math.round(v)}`;
    case 'dodgeInvuln':
      return `回避の無敵 +${Math.round(v)}f`;
    case 'mysticalFrames':
      return `ミスティカル +${sec(v)}`;
    case 'moveSpeed':
      return `移動 +${pct(v)}`;
    case 'damageTaken':
      return `受けるダメージ −${pct(v)}`;
    case 'heal':
      return `薬瓶の回復 +${pct(v)}`;
    case 'dropRate':
      return `ドロップ率 +${pct(v)}`;
    case 'killBuff':
      return `撃破で ${sec(KILL_BUFF.frames)}、攻撃力 +${pct(v)}（最大 ${KILL_BUFF.maxStacks} 回重なる）`;
  }
}

/** パッシブのレベル lv での効果の文章（「ダメージ +8% / ふっ飛ばし +6%」）。lv 0 は「未習得」 */
export function describePassive(def: PassiveDef, lv: number): string {
  if (lv <= 0) return '未習得';
  return def.effects.map((e) => effectText(e, lv)).join(' / ');
}

/** 満たしていない前提（空 = 習得・強化できる）。levels = いまの各パッシブのレベル */
export function unmetPrereqs(levels: PassiveLevelsLike, id: PassiveId): PassivePrereq[] {
  return (PASSIVES[id].prereq ?? []).filter((p) => (levels[p.id] ?? 0) < p.level);
}

/**
 * id のレベルを newLevel にしたとき、前提が割れてしまう習得済みのパッシブ（空 = 取り下げてよい）。
 * 例: 会心の心得を Lv2 → Lv1 にすると、Lv2 を前提にする急所突きが（習得済みなら）割れる
 */
export function brokenByLowering(levels: PassiveLevelsLike, id: PassiveId, newLevel: number): PassiveId[] {
  const out: PassiveId[] = [];
  for (const other of PASSIVE_ORDER) {
    if ((levels[other] ?? 0) <= 0) continue;
    for (const p of PASSIVES[other].prereq ?? []) if (p.id === id && newLevel < p.level) out.push(other);
  }
  return out;
}

/** levels の見え（読み取り専用。Growth もテストの素朴なオブジェクトも渡せる） */
export type PassiveLevelsLike = Readonly<Partial<Record<PassiveId, number>>>;
