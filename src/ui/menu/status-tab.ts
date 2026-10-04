import { h, onPress, setText } from '../dom';
import type { MenuTab } from '../pause-menu';
import type { Growth } from '../../combat/growth';
import { STAT_INFO, STAT_IDS, STAT_BASE, type StatId } from '../../combat/data/stats';
import { describeStat } from '../../combat/modifiers';

/**
 * メニューのタブ「ステータス」（ADR-033）: レベル・経験値・ステータスポイントの振り分け。
 * ＋ で 1 つ振る（押し続けると連打）、− は **メニューを開いてから振った分だけ** 戻せる。「全部振り直す」はいつでも無料（二度押しで実行）。
 * 効果の文章は Modifiers から読む（describeStat）。
 */

export interface StatusTabDeps {
  growth: Growth;
  /** 振り分けが変わった（ステータス・ポイント）。呼ぶ側が戦闘の数値・セーブ・画面を合わせる */
  onChange: () => void;
}

interface Row {
  value: HTMLElement;
  minus: HTMLButtonElement;
  plus: HTMLButtonElement;
  effect: HTMLElement;
}

export class StatusTab implements MenuTab {
  readonly id = 'status';
  readonly label = 'ステータス';
  private lvEl!: HTMLElement;
  private xpText!: HTMLElement;
  private xpFill!: HTMLElement;
  private statPts!: HTMLElement;
  private skillPts!: HTMLElement;
  private resetBtn!: HTMLButtonElement;
  private resetTimer = 0;
  private readonly rows = new Map<StatId, Row>();

  constructor(private readonly d: StatusTabDeps) {}

  /** 未使用のステータスポイントがあれば印を出す */
  mark = (): boolean => this.d.growth.statPoints > 0;

  build(root: HTMLElement): void {
    const g = this.d.growth;
    const head = h('div', 'st-head');
    this.lvEl = h('div', 'st-lv');
    const xp = h('div', 'st-xp');
    this.xpText = h('div', 'st-xp-text');
    const bar = h('div', 'st-xp-bar');
    this.xpFill = h('div', 'st-xp-fill');
    bar.appendChild(this.xpFill);
    xp.append(this.xpText, bar);
    const pts = h('div', 'st-pts');
    const a = h('div', 'st-pt');
    a.append(h('span', undefined, 'ステータスポイント'));
    this.statPts = h('b');
    a.appendChild(this.statPts);
    const b = h('div', 'st-pt');
    b.append(h('span', undefined, 'スキルポイント'));
    this.skillPts = h('b');
    b.appendChild(this.skillPts);
    pts.append(a, b);
    head.append(this.lvEl, xp, pts);
    root.appendChild(head);

    const list = h('div', 'st-list');
    for (const id of STAT_IDS) {
      const info = STAT_INFO[id];
      const row = h('div', 'st-row');
      const name = h('div', 'st-name');
      name.append(h('b', undefined, info.name), h('small', undefined, info.short));
      const ctrl = h('div', 'st-ctrl');
      const minus = h('button', 'st-btn', '−');
      minus.type = 'button';
      const value = h('span', 'st-val');
      const plus = h('button', 'st-btn plus', '＋');
      plus.type = 'button';
      ctrl.append(minus, value, plus);
      const effect = h('div', 'st-eff');
      const note = h('small', 'st-note', info.detail);
      const text = h('div', 'st-text');
      text.append(effect, note);
      row.append(name, ctrl, text);
      list.appendChild(row);
      onPress(plus, () => {
        const ok = g.addStat(id);
        if (ok) this.d.onChange();
        return ok;
      });
      onPress(minus, () => {
        const ok = g.removeStat(id);
        if (ok) this.d.onChange();
        return ok;
      });
      this.rows.set(id, { value, minus, plus, effect });
    }
    root.appendChild(list);

    this.resetBtn = h('button', 'menu-btn danger', 'ステータスを全部振り直す');
    this.resetBtn.type = 'button';
    onPress(
      this.resetBtn,
      () => {
        // 二度押しで実行（間違って押しても振り分けが消えない）。3 秒で元に戻る
        if (this.resetBtn.dataset.armed === '1') {
          this.disarm();
          g.resetStats();
          this.d.onChange();
        } else {
          this.resetBtn.dataset.armed = '1';
          this.resetBtn.textContent = 'もう一度押すと振り直し（無料）';
          window.clearTimeout(this.resetTimer);
          this.resetTimer = window.setTimeout(() => this.disarm(), 3000);
        }
        return false;
      },
      { repeat: false },
    );
    const foot = h('div', 'menu-foot');
    foot.appendChild(this.resetBtn);
    root.appendChild(foot);
  }

  private disarm(): void {
    window.clearTimeout(this.resetTimer);
    this.resetBtn.dataset.armed = '0';
    this.resetBtn.textContent = 'ステータスを全部振り直す';
  }

  refresh(): void {
    const g = this.d.growth;
    setText(this.lvEl, `Lv ${g.level}${g.maxed ? ' MAX' : ''}`);
    setText(this.xpText, g.maxed ? '経験値 — （上限）' : `経験値 ${g.xp} / ${g.xpNeed}`);
    this.xpFill.style.width = `${g.maxed ? 100 : Math.round((g.xp / g.xpNeed) * 100)}%`;
    setText(this.statPts, String(g.statPoints));
    setText(this.skillPts, String(g.skillPoints));
    this.statPts.parentElement!.classList.toggle('has', g.statPoints > 0);
    this.skillPts.parentElement!.classList.toggle('has', g.skillPoints > 0);
    const m = g.modifiers;
    for (const id of STAT_IDS) {
      const r = this.rows.get(id)!;
      const v = g.stat(id);
      setText(r.value, String(v));
      r.value.classList.toggle('raised', v > STAT_BASE);
      r.plus.disabled = !g.canAddStat(id);
      r.minus.disabled = !g.canRemoveStat(id);
      setText(r.effect, describeStat(id, m));
    }
  }
}
