/**
 * 装備の組（ロードアウト。ADR-020）。「武器」と「左手」の組で、技のセット・溜め・ガード・走る速さが決まる。
 * 素手が標準で、盾は装備で出す（片手剣のまま左手に盾を持つ）。両手の大剣は左手も柄を握る（= 盾は持てない）。
 * 数値は技ごと・ガードごとのデータ（attacks.ts / guard.ts / moveset.ts）にあり、ここは「どれを使うか」だけを持つ。
 */

import { GREATSWORD_VARIANT, SHIELD_VARIANT, SPEAR_VARIANT, STAFF_VARIANT } from '../../character/data/authored';
import { GUARDS, type GuardDef } from './guard';
import { GREATSWORD_MOVESET, SPEAR_MOVESET, STAFF_MOVESET, SWORD_MOVESET, type Moveset } from './moveset';

export type LoadoutId = 'sword' | 'sword-shield' | 'greatsword' | 'spear' | 'staff';

/** 持つ武器（見た目のメッシュ・剣筋の帯・溜めの光が武器ごとに変わる）。槍（spear。ADR-049）は両手持ちの長柄で、突き中心。杖（staff。ADR-048）は魔法の媒体で、攻撃はすべて詠唱 → 魔法 */
export type WeaponId = 'sword' | 'greatsword' | 'spear' | 'staff';

export interface LoadoutDef {
  id: LoadoutId;
  /** 表示名（開始画面・装備切替ボタン）と一行の説明 */
  name: string;
  detail: string;
  weapon: WeaponId;
  /** 左手が持つもの。'none' = 何も持たない（片手剣。大剣は左手も柄を握るが、持ち物ではないので 'none'） */
  offhand: 'none' | 'shield';
  moveset: Moveset;
  /** 溜めの定義（CHARGES のキー）。null = 溜め（攻撃の長押し）が無い武器（杖。通常攻撃は 1 ルートの連打だけ） */
  charge: string | null;
  /** ガード。null = 防御の構えが無い武器（杖。守りは回避だけ。ガードのボタンも出さない） */
  guard: GuardDef | null;
  /** 走る速さの倍率（盾の重さ） */
  runSpeedScale: number;
  /** 手付けクリップの版。'' = そのまま、SHIELD_VARIANT = 左腕を盾の持ち位置に固定して焼き直した版、GREATSWORD_VARIANT = 両手持ちで焼き直した版、SPEAR_VARIANT = 槍（両手持ち。右手が前）、STAFF_VARIANT = 杖（待機・走りが杖を立てて持つ版） */
  clipVariant: '' | typeof SHIELD_VARIANT | typeof GREATSWORD_VARIANT | typeof SPEAR_VARIANT | typeof STAFF_VARIANT;
}

export const LOADOUTS: Record<LoadoutId, LoadoutDef> = {
  sword: {
    id: 'sword',
    name: '片手剣',
    detail: '素手・軽快。剣で受ける',
    weapon: 'sword',
    offhand: 'none',
    moveset: SWORD_MOVESET,
    charge: 'sword',
    guard: GUARDS.sword,
    runSpeedScale: 1,
    clipVariant: '',
  },
  'sword-shield': {
    id: 'sword-shield',
    name: '片手剣 + 盾',
    detail: '盾で防ぐ・弾く（パリィ）',
    weapon: 'sword',
    offhand: 'shield',
    moveset: SWORD_MOVESET,
    charge: 'sword',
    guard: GUARDS.shield,
    runSpeedScale: 0.92,
    clipVariant: SHIELD_VARIANT,
  },
  greatsword: {
    id: 'greatsword',
    name: '大剣',
    detail: '重い一撃・広い範囲。厳しいパリィ',
    weapon: 'greatsword',
    offhand: 'none',
    moveset: GREATSWORD_MOVESET,
    charge: 'greatsword',
    guard: GUARDS.greatsword,
    runSpeedScale: 0.88,
    clipVariant: GREATSWORD_VARIANT,
  },
  spear: {
    id: 'spear',
    name: '槍',
    detail: '長い間合いの突き。手数が多く素早い',
    weapon: 'spear',
    offhand: 'none',
    moveset: SPEAR_MOVESET,
    charge: 'spear',
    guard: GUARDS.spear,
    runSpeedScale: 0.96,
    clipVariant: SPEAR_VARIANT,
  },
  staff: {
    id: 'staff',
    name: '杖',
    detail: '詠唱 → 魔法。隙は大きいが広範囲・高火力',
    weapon: 'staff',
    offhand: 'none',
    moveset: STAFF_MOVESET,
    charge: null,
    guard: null,
    runSpeedScale: 1,
    clipVariant: STAFF_VARIANT,
  },
};

/** 切替・開始画面で並べる順 */
export const LOADOUT_ORDER: readonly LoadoutId[] = ['sword', 'sword-shield', 'greatsword', 'spear', 'staff'];

export const DEFAULT_LOADOUT: LoadoutId = 'sword';

export function isLoadoutId(v: unknown): v is LoadoutId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(LOADOUTS, v);
}

/** 次の装備（切替ボタン）。LOADOUT_ORDER を順に回る */
export function nextLoadout(id: LoadoutId): LoadoutId {
  const i = LOADOUT_ORDER.indexOf(id);
  return LOADOUT_ORDER[(i + 1) % LOADOUT_ORDER.length]!;
}
