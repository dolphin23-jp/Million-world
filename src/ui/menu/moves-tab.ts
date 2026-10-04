import { h } from '../dom';
import type { MenuTab } from '../pause-menu';
import type { MoveNode } from '../../combat/move-tree';

/**
 * メニューのタブ「技表」（ADR-024。一時停止メニューの 1 タブになった）: 装備の技の一覧。始動の技と、そこから続けられる技を木で見せる。
 * 中身は src/combat/move-tree.ts（純粋関数）が作る。装備を替えたら setMoves で作り直す。
 */
export class MovesTab implements MenuTab {
  readonly id = 'moves';
  readonly label = '技表';
  private title!: HTMLElement;
  private body!: HTMLElement;

  build(root: HTMLElement): void {
    this.title = h('div', 'ml-title');
    this.body = h('div', 'ml-body');
    root.append(this.title, this.body);
  }

  refresh(): void {
    // 装備を替えたときに setMoves が作り直すので、開いたときに合わせるものは無い
  }

  /** 装備の技表を作り直す */
  setMoves(loadoutName: string, nodes: readonly MoveNode[]): void {
    this.title.textContent = `${loadoutName} の技`;
    this.body.textContent = '';
    for (const n of nodes) this.body.appendChild(this.row(n, 0));
  }

  private row(n: MoveNode, depth: number): HTMLElement {
    const wrap = h('div', 'ml-node');
    const line = h('div', `ml-line d${Math.min(depth, 5)}`);
    const input = h('span', 'ml-input', n.input + (n.needsLock ? '（ロック中）' : ''));
    const name = h('b', 'ml-name', n.name);
    line.append(input, name);
    if (n.note) line.appendChild(h('small', undefined, n.note));
    wrap.appendChild(line);
    for (const c of n.children) wrap.appendChild(this.row(c, depth + 1));
    return wrap;
  }
}
