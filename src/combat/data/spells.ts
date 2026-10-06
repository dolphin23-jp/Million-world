/**
 * 魔法の数値（ADR-048。杖）。杖の攻撃はすべて詠唱 → 魔法で、通常攻撃（魔弾の 1 ルート連打）もスキル（魔法）も同じ表にある。
 * 時間は sim フレーム（60Hz）、距離は m。ダメージは Lv1・威力 1 倍の値で、実際は × 威力（スキルのレベル・INT）× 会心。
 * 魔法を放つ時刻（詠唱の長さ）と詠唱のモーションは攻撃の定義（src/combat/data/spell-attacks.ts の cast）にあり、ここは放ったあとに何が起こるかだけを持つ。
 * クールダウン（CT）はスキルの定義（data/skills.ts）。MP は無い。CT は魔法を放った瞬間から数える（詠唱が潰されたら消費しない）。
 *
 * 状態異常（麻痺・凍結）は後回し（本人の指示）。`status` はデータの置き場だけで、まだ効かない。
 */

import type { SpellProjectileId } from './projectiles';

export type SpellId = 'bolt1' | 'bolt2' | 'bolt3' | 'thunder' | 'blizzard' | 'flame' | 'explosion' | 'regen' | 'hurricane';

/** 状態異常（後回し）: 当たった敵に、確率 chance で seconds 秒かかる。いまは使わない */
export interface SpellStatus {
  kind: 'paralyze' | 'freeze';
  seconds: number;
  chance: number;
}

/** 魔法の見た目の系統（SpellFx の描き分け。数値には影響しない） */
export type SpellElement = 'arcane' | 'lightning' | 'ice' | 'fire' | 'blast' | 'heal' | 'wind';

interface SpellBase {
  id: SpellId;
  name: string;
  /** スキルボタンに出す短い表記（4 文字まで） */
  short: string;
  detail: string;
  element: SpellElement;
  status?: SpellStatus;
}

/** 魔弾: 杖の頭から飛び道具を 1 発撃つ（通常攻撃）。命中したら burst があれば、そこで小さく爆ぜる */
export interface BoltSpell extends SpellBase {
  kind: 'bolt';
  /** 弾の種類（SPELL_PROJECTILES のキー） */
  projectile: SpellProjectileId;
  damage: number;
  knockback: number;
  hitStop: number;
  burst?: { radius: number; damage: number; knockback: number };
}

/** 落雷・爆発: ターゲットを中心にした範囲（地面の円）。warnFrames のあいだ床に予告の輪が出てから落ちる。周囲に散らして落とす（around）こともできる */
export interface StrikeSpell extends SpellBase {
  kind: 'strike';
  /** ターゲットの真上（ロックなし・対象がなければ前方 fallbackDistance の地点）に落ちる 1 発 */
  center: { radius: number; damage: number };
  /** ターゲットの周囲にばらまく落雷（count 本。ターゲットから ringMin〜ringMax の距離に等間隔の向きで） */
  around?: { count: number; ringMin: number; ringMax: number; radius: number; damage: number };
  /** 予告から着弾までのフレーム。around は center のあと staggerFrames ずつ遅れて落ちる */
  warnFrames: number;
  staggerFrames: number;
  /**
   * 予告の輪はターゲットを追うが、最初の着弾のこのフレーム数前から動かなくなる（ここからは走って逃げれば外れる。ターゲットがいない・ロックなしの正面の点は追わない）
   */
  lockFrames: number;
  /** 範囲の縁でのダメージの割合（1 = 一様。0.5 = 縁で半分）と、ノックバック（着弾の中心から外へ）・ヒットストップ */
  edgeFalloff: number;
  knockback: number;
  hitStop: number;
  /** ターゲットがいないとき、前方のこの距離に落とす */
  fallbackDistance: number;
}

/** 吹雪: 術者の前方の扇（近距離）に、一定間隔でダメージを与え続ける */
export interface ConeSpell extends SpellBase {
  kind: 'cone';
  range: number;
  halfAngleDeg: number;
  /** 続くフレームと、ダメージを与える間隔（フレーム）・1 回のダメージ */
  frames: number;
  tickFrames: number;
  damage: number;
  knockback: number;
  hitStop: number;
}

/** 火炎放射: 術者の前方の直線に、放出し続ける。放出のあいだ術者はその場に留まり、向きだけ変えられる（旋回の速さ turnRate） */
export interface BeamSpell extends SpellBase {
  kind: 'beam';
  length: number;
  /** 太さ（全幅 m。当たりは相手の体の半径を足した帯） */
  width: number;
  frames: number;
  tickFrames: number;
  damage: number;
  knockback: number;
  hitStop: number;
  /** 放出中の旋回の速さ（rad/s） */
  turnRate: number;
}

/** ハリケーン: 術者を中心に、同心円の風が内から外へ広がる（輪ごとに 1 回ずつ当たる） */
export interface RingSpell extends SpellBase {
  kind: 'ring';
  /** 輪ごとの外側の半径（m。内から外へ）と、輪の厚み（m）・広がる長さ（フレーム）・次の輪までの遅れ（フレーム） */
  radii: readonly number[];
  thickness: number;
  expandFrames: number;
  staggerFrames: number;
  damage: number;
  knockback: number;
  hitStop: number;
}

/** リジェネ: 術者の体力を、時間をかけて回復する（毎秒 hpPerSecond。薬瓶の回復量の倍率 = INT が掛かる）。画面に残りの印が出る */
export interface RegenSpell extends SpellBase {
  kind: 'regen';
  frames: number;
  hpPerSecond: number;
  /** 回復を適用する間隔（フレーム） */
  tickFrames: number;
}

export type SpellDef = BoltSpell | StrikeSpell | ConeSpell | BeamSpell | RingSpell | RegenSpell;

export const SPELLS: Record<SpellId, SpellDef> = {
  // ---- 通常攻撃: 魔弾の 1 ルート連打（魔弾 → 魔弾 → 大魔弾）。詠唱は短い。弾は杖の頭から前へまっすぐ ----
  bolt1: { id: 'bolt1', name: '魔弾', short: '魔弾', detail: '杖の先から魔力の弾を撃つ', element: 'arcane', kind: 'bolt', projectile: 'arcaneBolt', damage: 12, knockback: 0.6, hitStop: 3 },
  bolt2: { id: 'bolt2', name: '魔弾', short: '魔弾', detail: '杖の先から魔力の弾を撃つ', element: 'arcane', kind: 'bolt', projectile: 'arcaneBolt', damage: 14, knockback: 0.7, hitStop: 3 },
  bolt3: {
    id: 'bolt3',
    name: '大魔弾',
    short: '大魔弾',
    detail: '大きな魔力の弾。当たった所で爆ぜる',
    element: 'arcane',
    kind: 'bolt',
    projectile: 'arcaneBolt3',
    damage: 28,
    knockback: 1.8,
    hitStop: 8,
    burst: { radius: 2.2, damage: 18, knockback: 1.6 },
  },

  // ---- 魔法（スキル）。杖の画面に並列のボタンで出す ----
  thunder: {
    id: 'thunder',
    name: '落雷',
    short: '落雷',
    detail: 'ターゲットとその周囲に落雷を落とす（麻痺は後回し）',
    element: 'lightning',
    kind: 'strike',
    center: { radius: 1.7, damage: 64 },
    around: { count: 5, ringMin: 2.4, ringMax: 4.2, radius: 1.5, damage: 28 },
    warnFrames: 26,
    staggerFrames: 7,
    lockFrames: 10,
    edgeFalloff: 0.7,
    knockback: 1.4,
    hitStop: 9,
    fallbackDistance: 5,
    status: { kind: 'paralyze', seconds: 3, chance: 1 },
  },
  blizzard: {
    id: 'blizzard',
    name: '吹雪',
    short: '吹雪',
    detail: '前方の扇に吹雪を吹きつける（凍結は後回し）',
    element: 'ice',
    kind: 'cone',
    range: 5.4,
    halfAngleDeg: 52,
    frames: 72,
    tickFrames: 9,
    damage: 16,
    knockback: 0.12,
    hitStop: 0,
    status: { kind: 'freeze', seconds: 2, chance: 0.2 },
  },
  flame: {
    id: 'flame',
    name: '火炎放射',
    short: '火炎',
    detail: '前方の直線に炎を放ち続ける。放つあいだは向きを変えられる',
    element: 'fire',
    kind: 'beam',
    length: 7.2,
    width: 1.5,
    frames: 144,
    tickFrames: 6,
    damage: 7,
    knockback: 0.1,
    hitStop: 0,
    turnRate: 2.4,
  },
  explosion: {
    id: 'explosion',
    name: '爆発',
    short: '爆発',
    detail: 'ターゲットとその周囲の広い範囲を爆破する',
    element: 'blast',
    kind: 'strike',
    center: { radius: 4.2, damage: 120 },
    warnFrames: 32,
    staggerFrames: 0,
    lockFrames: 14,
    edgeFalloff: 0.5,
    knockback: 4,
    hitStop: 12,
    fallbackDistance: 5.5,
  },
  regen: {
    id: 'regen',
    name: '再生',
    short: '再生',
    detail: '一定時間、体力が少しずつ回復する',
    element: 'heal',
    kind: 'regen',
    frames: 600,
    hpPerSecond: 4,
    tickFrames: 30,
  },
  hurricane: {
    id: 'hurricane',
    name: '旋風',
    short: '旋風',
    detail: '自分の周囲に同心円の暴風を巻き起こす',
    element: 'wind',
    kind: 'ring',
    radii: [2.4, 4.0, 5.6],
    thickness: 1.5,
    expandFrames: 18,
    staggerFrames: 11,
    damage: 22,
    knockback: 2.6,
    hitStop: 5,
  },
};

/** スキルとして画面に並べる魔法（左から右の順。通常攻撃の魔弾は含まない） */
export const SPELL_SKILL_ORDER = ['thunder', 'blizzard', 'flame', 'explosion', 'regen', 'hurricane'] as const;
export type SpellSkillId = (typeof SPELL_SKILL_ORDER)[number];

/** ターゲット（ロック対象・正面の最も近い敵）を選ぶ範囲 */
export const SPELL_TARGETING = {
  /** 術者からの最大の距離（m）。ロック対象はこれより遠くても選ぶ */
  maxRange: 12,
  /** ロックなしのとき、正面からこの角度（度）以内の敵を選ぶ */
  frontConeDeg: 70,
  /** 魔法の起点（杖の先）を術者の中心から向いている方へ出す距離（m）。火炎放射・吹雪の始まり */
  muzzle: 0.9,
} as const;

/**
 * 魔弾が命中して爆ぜるときの範囲（BoltSpell.burst）を、SpellSystem が扱う落雷・爆発と同じ形（予告なし・すぐ着弾する 1 点）にしたもの。
 * 起動時に 1 度だけ作る（命中のたびに作らない）。burst の無い魔弾（bolt1・bolt2）は含まない
 */
export const BOLT_BURSTS: Partial<Record<SpellId, StrikeSpell>> = Object.fromEntries(
  Object.values(SPELLS)
    .filter((s): s is BoltSpell => s.kind === 'bolt' && s.burst !== undefined)
    .map((s) => {
      const b = s.burst!;
      const burst: StrikeSpell = {
        id: s.id,
        name: s.name,
        short: s.short,
        detail: s.detail,
        element: s.element,
        kind: 'strike',
        center: { radius: b.radius, damage: b.damage },
        warnFrames: 0,
        staggerFrames: 0,
        lockFrames: 0,
        edgeFalloff: 0.55,
        knockback: b.knockback,
        hitStop: 5,
        fallbackDistance: 0,
      };
      return [s.id, burst];
    }),
);
