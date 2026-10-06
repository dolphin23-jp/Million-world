import { SKILLS, SKILL_LEVEL_MAX, SKILL_ORDER, type SkillDef, type SkillId, type SkillStepDef } from './data/skills';
import type { WeaponId } from './data/loadouts';

/**
 * スキル（ADR-031）の状態と、レベルから決まる数値。three にも DOM にも依存しない純粋なクラス・関数。
 * 剣技の連なりを実際に動かすのは Player（Player.requestSkill）、ボタン・演出は Game。ここは「どのスキルを・どのレベルで・いつ使えるか」を持つ。
 */

/** 連なりの 1 段（実行用に、レベルと段の倍率を掛けた威力まで決めたもの） */
export interface SkillRunStep {
  attack: string;
  power: number;
}

export interface SkillRun {
  skill: SkillId;
  steps: readonly SkillRunStep[];
}

/** レベル level（1〜SKILL_LEVEL_MAX）の威力の倍率 */
export function skillPower(def: SkillDef, level: number): number {
  return def.power + def.powerPerLevel * (Math.max(1, level) - 1);
}

/** レベル level のクールダウン（sim フレーム）。scale は INT などによる倍率（1 = そのまま） */
export function skillCooldown(def: SkillDef, level: number, scale = 1): number {
  const lv = Math.max(1, level);
  return Math.max(1, Math.round(def.cooldownFrames * Math.max(0.1, 1 - def.cooldownPerLevel * (lv - 1)) * scale));
}

/** その段が、レベル level で使う攻撃（進化があれば、満たしている中でいちばん高いレベルのもの。なければ元の攻撃） */
export function stepAttackAt(step: SkillStepDef, level: number): string {
  let best = step.attack;
  let bestLevel = 0;
  for (const e of step.evolve ?? []) {
    if (e.minLevel <= level && e.minLevel > bestLevel) {
      best = e.attack;
      bestLevel = e.minLevel;
    }
  }
  return best;
}

/** レベル level で解放されている連なり（minLevel を満たす段だけ。順は定義のまま）。段ごとの威力 = スキルの威力 × 段の倍率 */
export function skillSteps(def: SkillDef, level: number): SkillRunStep[] {
  const power = skillPower(def, level);
  const out: SkillRunStep[] = [];
  for (const s of def.steps) {
    if ((s.minLevel ?? 1) > level) continue;
    out.push({ attack: stepAttackAt(s, level), power: power * (s.scale ?? 1) });
  }
  return out;
}

/** 画面に出す、あるレベルのスキルの数値（威力の倍率・クールダウン秒・連なりの段数。INT などの Modifiers は含めない = スキル自体の数値） */
export interface SkillInfo {
  level: number;
  power: number;
  cooldownSec: number;
  steps: number;
}

export function skillInfo(def: SkillDef, level: number): SkillInfo {
  return { level, power: skillPower(def, level), cooldownSec: skillCooldown(def, level) / 60, steps: skillSteps(def, level).length };
}

export class SkillBook {
  private readonly levels: Record<SkillId, number>;
  /** 武器の系統ごとの、スキルボタンで使う（選んでいる）スキル。未選択ならその系統の最初の使えるスキル */
  private readonly selected: Partial<Record<WeaponId, SkillId>> = {};
  private readonly cooldown: Record<SkillId, number>;
  private readonly cooldownMax: Record<SkillId, number>;
  /** 使えるスキル・レベル・選択が変わるたびに増える（UI が一覧を作り直すため）。クールダウンの減りでは増えない */
  serial = 0;

  /**
   * 最初のレベル。省略したら全スキル Lv1（M6-1 は習得の仕組みが無いので、全部使える。M6-3 のスキルポイントで 0 から振る形になる）
   */
  constructor(initial?: Partial<Record<SkillId, number>>) {
    const zero = Object.fromEntries(SKILL_ORDER.map((id) => [id, 0])) as Record<SkillId, number>;
    this.levels = { ...zero };
    this.cooldown = { ...zero };
    this.cooldownMax = { ...zero };
    for (const id of SKILL_ORDER) this.levels[id] = Math.min(SKILL_LEVEL_MAX, Math.max(0, initial?.[id] ?? 1));
  }

  level(id: SkillId): number {
    return this.levels[id];
  }

  setLevel(id: SkillId, level: number): void {
    const lv = Math.min(SKILL_LEVEL_MAX, Math.max(0, Math.round(level)));
    if (this.levels[id] === lv) return;
    this.levels[id] = lv;
    this.serial++;
  }

  /** その系統で使えるスキル（レベル 1 以上）。SKILL_ORDER の順 */
  available(family: WeaponId): SkillDef[] {
    return SKILL_ORDER.filter((id) => SKILLS[id].family === family && this.levels[id] >= 1).map((id) => SKILLS[id]);
  }

  /** 武器の系統ごとに選んでいるスキル（セーブ用。選んでいない系統は含まない） */
  selection(): Partial<Record<WeaponId, SkillId>> {
    return { ...this.selected };
  }

  /** 選択を全部外す（「最初から」）。使えるスキルの最初のものに戻る */
  clearSelection(): void {
    for (const k of Object.keys(this.selected) as WeaponId[]) delete this.selected[k];
    this.serial++;
  }

  /** セーブから選択を戻す（使えない・系統が合わないものは無視する） */
  restoreSelection(sel: Partial<Record<WeaponId, SkillId>>): void {
    for (const fam of ['sword', 'greatsword'] as const) {
      const id = sel[fam];
      if (id && SKILLS[id]?.family === fam && this.levels[id] >= 1) this.selected[fam] = id;
    }
    this.serial++;
  }

  /** その系統の、いま選んでいるスキル（使えるものが無ければ null） */
  selectedFor(family: WeaponId): SkillDef | null {
    const id = this.selected[family];
    if (id && SKILLS[id].family === family && this.levels[id] >= 1) return SKILLS[id];
    return this.available(family)[0] ?? null;
  }

  /** 選ぶ（使える・その系統のスキルだけ）。選べたら true */
  select(id: SkillId): boolean {
    const def = SKILLS[id];
    if (this.levels[id] < 1) return false;
    if (this.selected[def.family] === id) return true;
    this.selected[def.family] = id;
    this.serial++;
    return true;
  }

  /** 次（dir = 1）・前（-1）のスキルを選ぶ（キーボード用）。選んだスキルを返す（使えるものが無ければ null） */
  cycle(family: WeaponId, dir = 1): SkillDef | null {
    const list = this.available(family);
    if (list.length === 0) return null;
    const cur = this.selectedFor(family)!;
    const i = list.indexOf(cur);
    const next = list[(((i + dir) % list.length) + list.length) % list.length]!;
    this.select(next.id);
    return next;
  }

  /** クールダウン中か */
  ready(id: SkillId): boolean {
    return this.cooldown[id] <= 0;
  }

  /** クールダウンの残り（sim フレーム。使える = 0） */
  cooldownLeft(id: SkillId): number {
    return Math.max(0, this.cooldown[id]);
  }

  /** クールダウンの残りの割合（1 = 使った直後、0 = 使える） */
  cooldownRatio(id: SkillId): number {
    return this.cooldownMax[id] > 0 ? Math.max(0, this.cooldown[id] / this.cooldownMax[id]) : 0;
  }

  /**
   * その系統の、選んでいるスキルの連なり（実行用。powerScale は INT による威力の倍率）。選んでいない・クールダウン中なら null。ここではクールダウンに入らない
   * （Player が実際に始められたときだけ start する。始められない状態で押してもクールダウンを消費しない）
   */
  prepare(family: WeaponId, powerScale = 1): SkillRun | null {
    const def = this.selectedFor(family);
    return def ? this.prepareById(def.id, powerScale) : null;
  }

  /**
   * スキルを id で指定して、連なりを作る（杖の魔法は、全部を画面に並列のボタンで並べて、押したものをそのまま使う。選択を介さない。ADR-048）。
   * 未習得・クールダウン中なら null。ここではクールダウンに入らない
   */
  prepareById(id: SkillId, powerScale = 1): SkillRun | null {
    if (this.levels[id] < 1 || !this.ready(id)) return null;
    const steps = skillSteps(SKILLS[id], this.levels[id]);
    if (powerScale !== 1) for (const st of steps) st.power *= powerScale;
    return steps.length > 0 ? { skill: id, steps } : null;
  }

  /** 使った: クールダウンに入る（cooldownScale は INT などによる倍率） */
  start(id: SkillId, cooldownScale = 1): void {
    const frames = skillCooldown(SKILLS[id], this.levels[id], cooldownScale);
    this.cooldown[id] = frames;
    this.cooldownMax[id] = frames;
  }

  /** 毎 sim ステップ。全スキルのクールダウンを進める */
  step(): void {
    for (const id of SKILL_ORDER) if (this.cooldown[id] > 0) this.cooldown[id]--;
  }

  /** 最初の状態に戻す（再戦）。クールダウンだけ消す（レベルと選択は残す） */
  reset(): void {
    for (const id of SKILL_ORDER) {
      this.cooldown[id] = 0;
      this.cooldownMax[id] = 0;
    }
  }
}
