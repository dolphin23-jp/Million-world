import { h, onPress, setText } from '../dom';
import type { MenuTab } from '../pause-menu';
import type { Growth } from '../../combat/growth';
import type { SkillBook } from '../../combat/skills';
import { skillInfo } from '../../combat/skills';
import { SKILLS, SKILL_LEVEL_MAX, SKILL_ORDER, type SkillId } from '../../combat/data/skills';
import { PASSIVES, PASSIVE_CATEGORY_NAME, PASSIVE_CATEGORY_ORDER, PASSIVE_ORDER, describePassive, unmetPrereqs, type PassiveId } from '../../combat/data/passives';
import type { WeaponId } from '../../combat/data/loadouts';

/**
 * メニューのタブ「スキル」（ADR-033）: スキルポイントでスキルのレベルを上げる（Lv1〜10。数値はなめらかに伸び、Lv4 と Lv7 でモーションが進化する）。
 * ＋ で 1 つ上げる（押し続けると連打）、− は **メニューを開いてから上げた分だけ** 戻せる。「全部振り直す」はいつでも無料（二度押しで実行）。
 * 武器の系統（片手剣 / 大剣）ごとに並べる。いま装備している系統には「装備中」と出る。進化の説明は SkillDef.evolutions から読む。
 * その下に**パッシブ**（M6-5。ADR-037）: 攻め・守り・補給に分けて並べる。最初は未習得（Lv 0）で、1 ポイントで習得する。前提のあるものは「前提: ○○ Lv n」が出て、
 * 前提が満たされるまで暗く、上げられない。系統つきのもの（剣術習熟・剛力習熟）は、その武器を構えているあいだだけ効く（いまの装備と合わないときは「いまは効かない」）。
 */

export interface SkillsTabDeps {
  growth: Growth;
  book: SkillBook;
  /** いま装備している武器の系統（「装備中」の表示に使う） */
  currentFamily: () => WeaponId;
  onChange: () => void;
}

const FAMILY_NAME: Record<WeaponId, string> = { sword: '片手剣', greatsword: '大剣', staff: '杖（魔法）' };
const FAMILIES: readonly WeaponId[] = ['sword', 'greatsword', 'staff'];

interface PassiveCard {
  id: PassiveId;
  el: HTMLElement;
  lv: HTMLElement;
  pips: HTMLElement[];
  minus: HTMLButtonElement;
  plus: HTMLButtonElement;
  now: HTMLElement;
  next: HTMLElement;
  prereq: HTMLElement | null;
  inactive: HTMLElement | null;
}

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
  private readonly passiveCards: PassiveCard[] = [];
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
    head.append(pt, h('div', 'sk-hint', 'ポイントを使うと、剣技は威力が伸びてクールダウンが縮み（Lv4・Lv7 で動きが変わる）、パッシブは習得して強くなる'));
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

    this.buildPassives(root);

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

  /** パッシブの一覧（攻め・守り・補給）。カードの作りは剣技と同じ（＋/−・目盛り）で、効果の文章・前提・「いまは効かない」の行が付く */
  private buildPassives(root: HTMLElement): void {
    const g = this.d.growth;
    root.appendChild(h('div', 'sk-fam sk-passive-title', 'パッシブ'));
    root.appendChild(h('div', 'sk-hint pa-hint', '常に効く。最初は未習得で、1 ポイントで習得する。前提のあるものは、前提を満たすと習得できる。'));
    for (const cat of PASSIVE_CATEGORY_ORDER) {
      const ids = PASSIVE_ORDER.filter((id) => PASSIVES[id].category === cat);
      if (ids.length === 0) continue;
      root.appendChild(h('div', 'pa-cat', PASSIVE_CATEGORY_NAME[cat]));
      for (const id of ids) {
        const def = PASSIVES[id];
        const card = h('div', 'sk-card pa-card');
        const top = h('div', 'sk-top');
        const name = h('div', 'sk-name');
        name.append(h('b', undefined, def.name));
        if (def.family) name.append(h('span', 'pa-tag', def.family === 'sword' ? '片手剣' : '大剣'));
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
        for (let i = 1; i <= def.levelMax; i++) {
          const p = h('span', 'sk-pip');
          pips.push(p);
          pipsEl.appendChild(p);
        }
        const detail = h('div', 'sk-detail', def.detail);
        const now = h('div', 'pa-now');
        const next = h('div', 'pa-next');
        const prereq = def.prereq ? h('div', 'pa-prereq') : null;
        const inactive = def.family ? h('div', 'pa-inactive', `いまは効かない（${def.family === 'sword' ? '片手剣' : '大剣'}を構えているあいだだけ効く）`) : null;
        card.append(top, pipsEl, detail, now, next);
        if (prereq) card.appendChild(prereq);
        if (inactive) card.appendChild(inactive);
        root.appendChild(card);
        onPress(plus, () => {
          const ok = g.addPassive(id);
          if (ok) this.d.onChange();
          return ok;
        });
        onPress(minus, () => {
          const ok = g.removePassive(id);
          if (ok) this.d.onChange();
          return ok;
        });
        this.passiveCards.push({ id, el: card, lv, pips, minus, plus, now, next, prereq, inactive });
      }
    }
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
    for (const c of this.passiveCards) {
      const def = PASSIVES[c.id];
      const lv = g.passiveLevel(c.id);
      const unmet = unmetPrereqs(g.passiveLevels, c.id);
      const locked = lv === 0 && unmet.length > 0;
      c.el.classList.toggle('locked', locked);
      c.el.classList.toggle('learned', lv > 0);
      setText(c.lv, lv === 0 ? '未習得' : `Lv ${lv} / ${def.levelMax}`);
      c.pips.forEach((p, i) => p.classList.toggle('on', i < lv));
      c.plus.disabled = !g.canAddPassive(c.id);
      c.minus.disabled = !g.canRemovePassive(c.id);
      setText(c.now, lv === 0 ? '効果: 未習得' : `効果: ${describePassive(def, lv)}`);
      setText(c.next, lv >= def.levelMax ? '最大' : `次のレベル: ${describePassive(def, lv + 1)}`);
      if (c.prereq && def.prereq) {
        setText(c.prereq, `前提: ${def.prereq.map((p) => `${PASSIVES[p.id].name} Lv${p.level}`).join('・')}${unmet.length === 0 ? '（満たしている）' : ''}`);
        c.prereq.classList.toggle('unmet', unmet.length > 0);
      }
      // 系統つきのパッシブが、いま構えている武器と合わないとき
      if (c.inactive) c.inactive.hidden = !(lv > 0 && def.family !== cur);
    }
  }
}
