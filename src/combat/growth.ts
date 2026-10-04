import { GROWTH, xpToNext } from './data/growth';
import { SKILL_LEVEL_MAX, SKILL_ORDER, type SkillId } from './data/skills';
import { STAT_BASE, STAT_IDS, type StatId } from './data/stats';
import { baseStats, computeModifiers, type Modifiers, type StatBlock } from './modifiers';

/**
 * 成長の状態（M6-2。ADR-033。設計は docs/07 §3）: 経験値・レベル・ステータスポイント・スキルポイント・ステータス・スキルのレベル。
 * three にも DOM にも時間にも依存しない純粋なクラス。経験値は「撃破の合図」から Game が渡す（Encounter・闘技場に依存しない。docs/07 §5.3）。
 *
 * レベルが上がるたびに、ステータスポイント +3・スキルポイント +1（GROWTH）。ポイントの振り分けは一時停止メニュー（M6-2c）で行う:
 *  - 振る（addStat / addSkill）はポイントを 1 つ使う。**戻す（removeStat / removeSkill）は、メニューを開いてから（beginEdit）振った分だけ** 戻せる。
 *    間違えて振っても、閉じるまでは取り消せる。
 *  - 全部振り直す（resetStats / resetSkills）は、いつでも無料（試行錯誤を罰しない。docs/07 §2.3）。
 * 不変条件: 未使用のポイント + 振った点 = もらった点（(level − 1) × レベルごとの点）。読み込み時に壊れていたら、振り分けを初期に戻してポイントを返す。
 */

export interface GrowthSnapshot {
  level: number;
  /** いまのレベルの中で溜めた経験値（0 以上、次のレベルに要る経験値より小さい） */
  xp: number;
  statPoints: number;
  skillPoints: number;
  stats: Record<StatId, number>;
  /** スキルごとのレベル（1〜SKILL_LEVEL_MAX。M6-2 は全スキルを Lv1 で習得済みから始める） */
  skills: Record<SkillId, number>;
}

function baseSkills(): Record<SkillId, number> {
  return Object.fromEntries(SKILL_ORDER.map((id) => [id, 1])) as Record<SkillId, number>;
}

const int = (v: unknown, lo: number, hi: number, def: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : def;
  return Math.min(hi, Math.max(lo, n));
};

export class Growth {
  level = 1;
  xp = 0;
  statPoints = 0;
  skillPoints = 0;
  private readonly stats: Record<StatId, number> = baseStats();
  private readonly skills: Record<SkillId, number> = baseSkills();
  /** 振り分けの編集の起点（beginEdit のときの値）。戻せるのはここまで */
  private edit: { stats: Record<StatId, number>; skills: Record<SkillId, number> } | null = null;
  /** 何かが変わるたびに増える（UI の作り直し・セーブの合図・Modifiers の再計算） */
  serial = 0;
  private modsSerial = -1;
  private mods: Modifiers = computeModifiers(this.stats);

  constructor(init?: Partial<GrowthSnapshot>) {
    if (init) this.restore(init);
  }

  /** 保存したものから戻す。範囲を丸め、不変条件が壊れていたら振り分けを初期に戻してポイントを返す */
  private restore(s: Partial<GrowthSnapshot>): void {
    this.level = int(s.level, 1, GROWTH.levelMax, 1);
    const need = xpToNext(this.level);
    this.xp = need > 0 ? int(s.xp, 0, need - 1, 0) : 0;
    this.statPoints = int(s.statPoints, 0, 99999, 0);
    this.skillPoints = int(s.skillPoints, 0, 99999, 0);
    let statSpent = 0;
    for (const id of STAT_IDS) {
      this.stats[id] = int(s.stats?.[id], STAT_BASE, 99999, STAT_BASE);
      statSpent += this.stats[id] - STAT_BASE;
    }
    let skillSpent = 0;
    for (const id of SKILL_ORDER) {
      this.skills[id] = int(s.skills?.[id], 1, SKILL_LEVEL_MAX, 1);
      skillSpent += this.skills[id] - 1;
    }
    const earnedStat = (this.level - 1) * GROWTH.statPointsPerLevel;
    const earnedSkill = (this.level - 1) * GROWTH.skillPointsPerLevel;
    if (this.statPoints + statSpent !== earnedStat) {
      for (const id of STAT_IDS) this.stats[id] = STAT_BASE;
      this.statPoints = earnedStat;
    }
    if (this.skillPoints + skillSpent !== earnedSkill) {
      for (const id of SKILL_ORDER) this.skills[id] = 1;
      this.skillPoints = earnedSkill;
    }
    this.serial++;
  }

  /** 最初から（セーブの消去）。レベル 1・経験値 0・ポイント 0・ステータスは初期・スキルは Lv1 */
  reset(): void {
    this.level = 1;
    this.xp = 0;
    this.statPoints = 0;
    this.skillPoints = 0;
    for (const id of STAT_IDS) this.stats[id] = STAT_BASE;
    for (const id of SKILL_ORDER) this.skills[id] = 1;
    if (this.edit) this.edit = { stats: { ...this.stats }, skills: { ...this.skills } };
    this.serial++;
  }

  toSnapshot(): GrowthSnapshot {
    return { level: this.level, xp: this.xp, statPoints: this.statPoints, skillPoints: this.skillPoints, stats: { ...this.stats }, skills: { ...this.skills } };
  }

  stat(id: StatId): number {
    return this.stats[id];
  }

  skillLevel(id: SkillId): number {
    return this.skills[id];
  }

  /** ステータスの読み取り専用の見え（computeModifiers に渡せる） */
  get statBlock(): StatBlock {
    return this.stats;
  }

  /** いまの効果の集計（変化があったときだけ作り直す） */
  get modifiers(): Modifiers {
    if (this.modsSerial !== this.serial) {
      this.mods = computeModifiers(this.stats);
      this.modsSerial = this.serial;
    }
    return this.mods;
  }

  get maxed(): boolean {
    return this.level >= GROWTH.levelMax;
  }

  /** 次のレベルまでに要る経験値（上限のレベルでは 0） */
  get xpNeed(): number {
    return xpToNext(this.level);
  }

  /** 経験値を足す。上がったレベルの数を返す（レベルごとにポイントが増える）。上限のレベルでは何も起きない */
  addXp(amount: number): number {
    if (!(amount > 0) || this.maxed) return 0;
    this.xp += Math.round(amount);
    let gained = 0;
    while (!this.maxed && this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      this.level++;
      this.statPoints += GROWTH.statPointsPerLevel;
      this.skillPoints += GROWTH.skillPointsPerLevel;
      gained++;
    }
    if (this.maxed) this.xp = 0;
    this.serial++;
    return gained;
  }

  // ---------------------------------------------------------------- 振り分け

  /** 振り分けの編集を始める（メニューを開いたとき）。戻せるのは、ここから振った分まで */
  beginEdit(): void {
    this.edit = { stats: { ...this.stats }, skills: { ...this.skills } };
  }

  /** 編集を終える（メニューを閉じたとき）。振った分は確定する */
  endEdit(): void {
    this.edit = null;
  }

  canAddStat(id: StatId): boolean {
    return this.statPoints > 0 && id in this.stats;
  }

  addStat(id: StatId): boolean {
    if (!this.canAddStat(id)) return false;
    this.stats[id]++;
    this.statPoints--;
    this.serial++;
    return true;
  }

  canRemoveStat(id: StatId): boolean {
    return this.edit !== null && this.stats[id] > this.edit.stats[id];
  }

  removeStat(id: StatId): boolean {
    if (!this.canRemoveStat(id)) return false;
    this.stats[id]--;
    this.statPoints++;
    this.serial++;
    return true;
  }

  canAddSkill(id: SkillId): boolean {
    return this.skillPoints > 0 && this.skills[id] < SKILL_LEVEL_MAX;
  }

  addSkill(id: SkillId): boolean {
    if (!this.canAddSkill(id)) return false;
    this.skills[id]++;
    this.skillPoints--;
    this.serial++;
    return true;
  }

  canRemoveSkill(id: SkillId): boolean {
    return this.edit !== null && this.skills[id] > this.edit.skills[id];
  }

  removeSkill(id: SkillId): boolean {
    if (!this.canRemoveSkill(id)) return false;
    this.skills[id]--;
    this.skillPoints++;
    this.serial++;
    return true;
  }

  /** ステータスの振り分けを全部戻す（無料）。振った点がすべてステータスポイントに戻る */
  resetStats(): void {
    for (const id of STAT_IDS) {
      this.statPoints += this.stats[id] - STAT_BASE;
      this.stats[id] = STAT_BASE;
    }
    if (this.edit) this.edit.stats = { ...this.stats };
    this.serial++;
  }

  /** スキルのレベルを全部 Lv1 に戻す（無料）。上げた分がスキルポイントに戻る */
  resetSkills(): void {
    for (const id of SKILL_ORDER) {
      this.skillPoints += this.skills[id] - 1;
      this.skills[id] = 1;
    }
    if (this.edit) this.edit.skills = { ...this.skills };
    this.serial++;
  }
}
