import { CHARGES } from './data/attacks';
import { MOVE_ATTACKS } from './data/spell-attacks';
import { moveName } from './data/move-names';
import type { Moveset } from './data/moveset';
import type { GuideData } from './move-guide';

/**
 * 技表（コマンド一覧）の中身（純粋関数。ADR-024）: 装備の技のセットから、始動の技と、そこから続けられる技の木を作る。
 * データ（AttackDef.next / branches、CHARGES）から作るので、技を足せば技表にも出る。DOM は src/ui/move-list.ts。
 */

export interface MoveNode {
  /** この技を出す入力（例: 「前 + 攻撃」「連打」） */
  input: string;
  /** ロック中でないと出せない入力か */
  needsLock: boolean;
  name: string;
  /** 補足（溜めの段階など）。無ければ null */
  note: string | null;
  children: MoveNode[];
}

const MAX_DEPTH = 8;

/** 技 id から、続く技の子ノードを作る。cycle = いまの経路の技（循環で止める） */
function follow(id: string, data: GuideData, cycle: readonly string[]): MoveNode[] {
  const a = data.attacks[id];
  if (!a || cycle.length >= MAX_DEPTH) return [];
  const out: MoveNode[] = [];
  const add = (input: string, target: string | undefined, needsLock: boolean): void => {
    if (target === undefined || cycle.includes(target)) return;
    out.push({ input, needsLock, name: data.name(target), note: null, children: follow(target, data, [...cycle, target]) });
  };
  add('連打', a.next, false);
  add('前 + 攻撃', a.branches?.forward, false);
  add('横 + 攻撃', a.branches?.side, true);
  add('後ろ + 攻撃', a.branches?.back, true);
  return out;
}

export function buildMoveTree(moveset: Moveset, chargeId: string | null, data: GuideData = { attacks: MOVE_ATTACKS, charges: CHARGES, name: moveName }): MoveNode[] {
  const root = (input: string, id: string, needsLock = false, note: string | null = null): MoveNode => ({ input, needsLock, name: data.name(id), note, children: follow(id, data, [id]) });
  const nodes: MoveNode[] = [
    root('攻撃', moveset.light),
    root('前 + 攻撃', moveset.lunge),
    root('横 + 攻撃', moveset.sweep, true),
    root('後ろ + 攻撃', moveset.retreat, true),
    root('ロール直後 + 攻撃', moveset.dashRoll),
    root('後ろステップ直後 + 攻撃', moveset.dashBack),
  ];
  const c = chargeId === null ? undefined : data.charges[chargeId];
  if (c) {
    nodes.push(root('攻撃を長押し → 離す', c.next, false, '溜めるほど強い'));
    // 段階で技が変わるもの（最大まで溜めたときの技など）
    c.levels.forEach((_, i) => {
      const id = c.levelNext?.[i + 1];
      if (id !== undefined && id !== c.next) nodes.push(root(i + 1 === c.levels.length ? '最大まで溜めて離す' : `${i + 1} 段階まで溜めて離す`, id));
    });
  }
  return nodes;
}
