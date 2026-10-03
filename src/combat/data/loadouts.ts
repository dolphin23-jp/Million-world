/**
 * 装備の組（ロードアウト。ADR-020）。「武器」と「左手」の組で、技のセット・溜め・ガード・走る速さが決まる。
 * 素手が標準で、盾は装備で出す（片手剣のまま左手に盾を持つ）。両手の大剣は M4-3 で足す（左手は塞がる = 盾は持てない）。
 * 数値は技ごと・ガードごとのデータ（attacks.ts / guard.ts / moveset.ts）にあり、ここは「どれを使うか」だけを持つ。
 */

import { SHIELD_VARIANT } from '../../character/data/authored';
import { GUARDS, type GuardDef } from './guard';
import { SWORD_MOVESET, type Moveset } from './moveset';

export type LoadoutId = 'sword' | 'sword-shield';

export interface LoadoutDef {
  id: LoadoutId;
  /** 表示名（開始画面・装備切替ボタン）と一行の説明 */
  name: string;
  detail: string;
  offhand: 'none' | 'shield';
  moveset: Moveset;
  /** 溜めの定義（CHARGES のキー） */
  charge: string;
  guard: GuardDef;
  /** 走る速さの倍率（盾の重さ） */
  runSpeedScale: number;
  /** 手付けクリップの版。'' = そのまま、SHIELD_VARIANT = 左腕を盾の持ち位置に固定して焼き直した版 */
  clipVariant: '' | typeof SHIELD_VARIANT;
}

export const LOADOUTS: Record<LoadoutId, LoadoutDef> = {
  sword: {
    id: 'sword',
    name: '片手剣',
    detail: '素手・軽快。剣で受ける',
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
    offhand: 'shield',
    moveset: SWORD_MOVESET,
    charge: 'sword',
    guard: GUARDS.shield,
    runSpeedScale: 0.92,
    clipVariant: SHIELD_VARIANT,
  },
};

/** 切替・開始画面で並べる順 */
export const LOADOUT_ORDER: readonly LoadoutId[] = ['sword', 'sword-shield'];

export const DEFAULT_LOADOUT: LoadoutId = 'sword';

export function isLoadoutId(v: unknown): v is LoadoutId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(LOADOUTS, v);
}

/** 次の装備（切替ボタン）。LOADOUT_ORDER を順に回る */
export function nextLoadout(id: LoadoutId): LoadoutId {
  const i = LOADOUT_ORDER.indexOf(id);
  return LOADOUT_ORDER[(i + 1) % LOADOUT_ORDER.length]!;
}
