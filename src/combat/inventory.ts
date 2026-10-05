import { ITEMS, ITEM_ORDER, ITEM_RULES, type DropDef, type ItemId } from './data/items';

/**
 * アイテム欄（ADR-030）。持っている数・選んでいるアイテム・使い直しの待ち・ドロップの抽選。
 * three にも DOM にも依存しない純粋なクラス。体力を実際に回復するのは呼ぶ側（Game が Player.heal を呼ぶ）。
 */

export type UseResult =
  | { ok: true; item: ItemId }
  /** none = 持っていない、wait = 使い直しの待ち、full = 回復が要らない（体力が満タン） */
  | { ok: false; reason: 'none' | 'wait' | 'full' };

export class Inventory {
  private readonly counts: Record<ItemId, number> = { potionS: 0, potionM: 0 };
  /** 選んでいるアイテム（ボタンに出る。タップで使うのはこれ） */
  selected: ItemId = ITEM_ORDER[0]!;
  /** 次に使えるまでの残り（sim フレーム） */
  cooldown = 0;
  /** 何も落ちなかった撃破の連続数（救済用） */
  private dry = 0;
  /** 数が変わるたびに増える（UI が変化を検出するため） */
  serial = 0;

  constructor() {
    this.reset();
  }

  count(id: ItemId): number {
    return this.counts[id];
  }

  /** いま持っているアイテムの総数 */
  get total(): number {
    let n = 0;
    for (const id of ITEM_ORDER) n += this.counts[id];
    return n;
  }

  /** 実際に増えた数を返す（持てる数 max を超える分は拾えない） */
  add(id: ItemId, n = 1): number {
    const room = ITEMS[id].max - this.counts[id];
    const added = Math.max(0, Math.min(n, room));
    if (added > 0) {
      this.counts[id] += added;
      this.serial++;
    }
    return added;
  }

  /** 選ぶ。持っていなくても選べる（空でも「小」を選んでおける） */
  select(id: ItemId): void {
    if (this.selected === id) return;
    this.selected = id;
    this.serial++;
  }

  /** 次（dir = 1）・前（-1）のアイテムを選ぶ（キーボード用）。選んだものを返す */
  cycle(dir = 1): ItemId {
    const i = ITEM_ORDER.indexOf(this.selected);
    const n = ITEM_ORDER.length;
    this.select(ITEM_ORDER[(((i + dir) % n) + n) % n]!);
    return this.selected;
  }

  /** 毎 sim ステップ。使い直しの待ちを進める */
  step(): void {
    if (this.cooldown > 0) this.cooldown--;
  }

  /**
   * 選んでいるアイテムを使う。使えたら 1 つ減らして待ちに入る。
   * hpMissing = 減っている体力（0 なら回復が要らないので使わない）
   */
  use(hpMissing: number): UseResult {
    const id = this.selected;
    if (this.counts[id] <= 0) return { ok: false, reason: 'none' };
    if (this.cooldown > 0) return { ok: false, reason: 'wait' };
    if (hpMissing <= 0) return { ok: false, reason: 'full' };
    this.counts[id]--;
    this.cooldown = ITEMS[id].cooldownFrames;
    this.serial++;
    return { ok: true, item: id };
  }

  /**
   * 倒した敵のドロップを抽選して、落ちたアイテムを返す（持てる数がいっぱいの分は除く）。rand は 0 以上 1 未満の乱数。
   * 救済: 何も落ちない撃破が pityKills 続いたら、次は必ず pityItem が落ちる。落ちたものはこの場で add しない（呼ぶ側が拾う演出のあと add する）。
   * chanceScale = ドロップ率の倍率（パッシブの薬師。Modifiers.dropRate。省略 = 等倍。ADR-037）
   * pity = false なら救済の数え方に関わらない（撃破ではない壊せる物の抽選。落ちなくても数えず、落ちても数え直さない。M7-4d）
   */
  rollDrops(drops: readonly DropDef[] | undefined, rand: () => number, chanceScale = 1, pity = true): ItemId[] {
    const out: ItemId[] = [];
    for (const d of drops ?? []) {
      if (this.counts[d.item] + out.filter((x) => x === d.item).length >= ITEMS[d.item].max) continue;
      if (rand() < Math.min(1, d.chance * chanceScale)) out.push(d.item);
    }
    if (!pity) return out;
    if (out.length === 0) {
      this.dry++;
      if (this.dry >= ITEM_RULES.pityKills && this.counts[ITEM_RULES.pityItem] < ITEMS[ITEM_RULES.pityItem].max) out.push(ITEM_RULES.pityItem);
    }
    if (out.length > 0) this.dry = 0;
    return out;
  }

  /** 最初の状態に戻す（再戦）。選択は残す（好みなので） */
  reset(): void {
    for (const id of ITEM_ORDER) this.counts[id] = ITEM_RULES.start[id] ?? 0;
    this.cooldown = 0;
    this.dry = 0;
    this.serial++;
  }
}
