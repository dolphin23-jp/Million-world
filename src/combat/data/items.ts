/**
 * アイテム（薬瓶。ADR-030）の数値。敵を倒すと確率で落とし、ストックして、ボタンで使う。
 * 数値はここだけで調整する（ドロップの確率は敵ごとに EnemyDef.drops。ここは「何がどれだけ効くか」と「持てる数・使い直しの待ち」）。
 */

export type ItemId = 'potionS' | 'potionM';

export interface ItemDef {
  readonly id: ItemId;
  /** 技表・ボタン・ポップアップに出す名前と、ボタンの中の短い表記 */
  readonly name: string;
  readonly short: string;
  /** 回復する体力（HP） */
  readonly heal: number;
  /** 持てる数（これを超える分は拾えない） */
  readonly max: number;
  /** 使ったあと、次にアイテムを使えるまで（sim フレーム。全アイテム共通の待ちとして Inventory が使う） */
  readonly cooldownFrames: number;
  /** ボタン・ポップアップの色（CSS） */
  readonly color: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  potionS: { id: 'potionS', name: '薬瓶（小）', short: '小', heal: 30, max: 5, cooldownFrames: 45, color: '#6fe39a' },
  potionM: { id: 'potionM', name: '薬瓶（中）', short: '中', heal: 60, max: 3, cooldownFrames: 45, color: '#6fc9ff' },
};

/** アイテム欄に並ぶ順（ポップアップの近い順） */
export const ITEM_ORDER: readonly ItemId[] = ['potionS', 'potionM'];

/** 敵 1 種のドロップ（EnemyDef.drops）。chance は倒したときに落とす確率（0..1）。種類ごとに別々に抽選する */
export interface DropDef {
  readonly item: ItemId;
  readonly chance: number;
}

export const ITEM_RULES = {
  /** 最初に持っている数（無し。最初の 1 本は戦って手に入れる） */
  start: {} as Partial<Record<ItemId, number>>,
  /**
   * 救済: 何も落ちない撃破がこの数だけ続いたら、次の撃破で必ず薬瓶（小）が落ちる（運の悪い回で、まったく回復できないことを防ぐ）。
   * 持てる数がいっぱいのときは数えない（拾えない = 落ちなかったことにならない）
   */
  pityKills: 8,
  pityItem: 'potionS' as ItemId,
  /** 使えないとき（体力が満タン・使い直しの待ち・数が 0）に鳴らす「使えない」の音を出すか */
  denySound: true,
} as const;
