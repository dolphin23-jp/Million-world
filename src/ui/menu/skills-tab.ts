import { h, onPress, setText } from '../dom';
import type { MenuTab } from '../pause-menu';
import type { Growth } from '../../combat/growth';
import type { SkillBook } from '../../combat/skills';
import { skillInfo } from '../../combat/skills';
import { SKILLS, SKILL_LEVEL_MAX, SKILL_ORDER, type SkillId } from '../../combat/data/skills';
import type { WeaponId } from '../../combat/data/loadouts';

/**
 * メニューのタブ「スキル」（ADR-033）: スキルポイントでスキルのレベルを上げる（Lv1〜10。数値はなめらかに伸び、Lv4 と Lv7 でモーションが進化する）。
 * ＋ で 1 つ上げる（押し続けると連打）、− は **メニューを開いてから上げた分だけ** 戻せる。「全部振り直す」はいつでも無料（二度押しで実行）。
 * 武器の系統（片手剣 / 大剣）ごとに並べる。いま装備している系統には「装備中」と出る。進化の説明は SkillDef.evolutions から読む。
 */

export interface SkillsTabDeps {
  growth: Growth;
  book: SkillBook;
  /** いま装備している武器の系統（「装備中」の表示に使う） */
  currentFamily: () => WeaponId;
  onChange: () => void;
}

const FAMILY_NAME: Record<WeaponId, string> = { sword: '片手剣', greatsword: '大剣' };
const FAMILIES: readonly WeaponId[] = ['sword', 'greatsword'];

interface Card {
  id: SkillId;
  lv: HTMLElement;
  pips: HTMLElement[];
  minus: HTMLButtonElement;
  plus: HTMLButtonElement;
  stat: HTMLElement;
  evo: { level: number; row: HTMLElement }[];
}

export class SkillsTab implements MenuTab {
  readonly id = 'skills';
  readonly label = 'スキル';
  private skillPts!: HTMLElement;
  private resetBtn!: HTMLButtonElement;
  private resetTimer = 0;
  private readonly cards: Card[] = [];
  private readonly famTitle = new Map<WeaponId, HTMLElement>();

  constructor(private readonly d: SkillsTabDeps) {}

  /** 未使用のスキルポイントがあれば印を出す */
  mark = (): boolean => this.d.growth.skillPoints > 0;

  build(root: HTMLElement): void {
    const g = this.d.growth;
    const head = h('div', 'sk-head');
    const pt = h('div', 'st-pt');
    pt.append(h('span', undefined, 'スキルポイント'));
    this.skillPts = h('b');
    pt.appendChild(this.skillPts);
    head.append(pt, h('div', 'sk-hint', 'ポイントを使うと威力が伸び、クールダウンが縮む。Lv4 と Lv7 で動きが変わる'));
    root.appendChild(head);

    for (const fam of FAMILIES) {
      const defs = SKILL_ORDER.map((id) => SKILLS[id]).filter((s) => s.family === fam);
      if (defs.length === 0) continue;
      const title = h('div', 'sk-fam');
      title.append(h('b', undefined, FAMILY_NAME[fam]), h('small', 'sk-equipped', '装備中'));
      this.famTitle.set(fam, title);
      root.appendChild(title);
      for (const def of defs) {
        const card = h('div', 'sk-card');
        const top = h('div', 'sk-top');
        const name = h('div', 'sk-name');
        name.append(h('b', undefined, def.name));
        const lv = h('span', 'sk-lv');
        name.appendChild(lv);
        const ctrl = h('div', 'st-ctrl');
        const minus = h('button', 'st-btn', '−');
        minus.type = 'button';
        const plus = h('button', 'st-btn plus', '＋');
        plus.type = 'button';
        ctrl.append(minus, plus);
        top.append(name, ctrl);
        const pipsEl = h('div', 'sk-pips');
        const pips: HTMLElement[] = [];
        for (let i = 1; i <= SKILL_LEVEL_MAX; i++) {
          const p = h('span', 'sk-pip');
          if ((def.evolutions ?? []).some((e) => e.level === i)) p.classList.add('evo');
          pips.push(p);
          pipsEl.appendChild(p);
        }
        const detail = h('div', 'sk-detail', def.detail);
        const stat = h('div', 'sk-stat');
        const evoEl = h('div', 'sk-evos');
        const evo: Card['evo'] = [];
        for (const e of def.evolutions ?? []) {
          const row = h('div', 'sk-evo');
          row.append(h('b', undefined, `Lv${e.level}`), h('span', undefined, e.text));
          evoEl.appendChild(row);
          evo.push({ level: e.level, row });
        }
        card.append(top, pipsEl, detail, stat, evoEl);
        root.appendChild(card);
        onPress(plus, () => {
          const ok = g.addSkill(def.id);
          if (ok) this.d.onChange();
          return ok;
        });
        onPress(minus, () => {
          const ok = g.removeSkill(def.id);
          if (ok) this.d.onChange();
          return ok;
        });
        this.cards.push({ id: def.id, lv, pips, minus, plus, stat, evo });
      }
    }

    this.resetBtn = h('button', 'menu-btn danger', 'スキルを全部振り直す');
    this.resetBtn.type = 'button';
    onPress(
      this.resetBtn,
      () => {
        if (this.resetBtn.dataset.armed === '1') {
          this.disarm();
          g.resetSkills();
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
    this.resetBtn.textContent = 'スキルを全部振り直す';
  }

  refresh(): void {
    const g = this.d.growth;
    setText(this.skillPts, String(g.skillPoints));
    this.skillPts.parentElement!.classList.toggle('has', g.skillPoints > 0);
    const cur = this.d.currentFamily();
    for (const [fam, el] of this.famTitle) el.classList.toggle('current', fam === cur);
    for (const c of this.cards) {
      const lv = g.skillLevel(c.id);
      const def = SKILLS[c.id];
      const info = skillInfo(def, lv);
      setText(c.lv, `Lv ${lv} / ${SKILL_LEVEL_MAX}`);
      c.pips.forEach((p, i) => p.classList.toggle('on', i < lv));
      c.plus.disabled = !g.canAddSkill(c.id);
      c.minus.disabled = !g.canRemoveSkill(c.id);
      setText(c.stat, `威力 ×${info.power.toFixed(2)}　クールダウン ${info.cooldownSec.toFixed(1)} 秒　連なり ${info.steps} 段`);
      for (const e of c.evo) e.row.classList.toggle('on', lv >= e.level);
    }
  }
}
