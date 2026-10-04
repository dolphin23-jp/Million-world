import { SKILL_ORDER, isSkillId, SKILLS, type SkillId } from './data/skills';
import { STAT_IDS, type StatId } from './data/stats';
import type { WeaponId } from './data/loadouts';
import { Growth, type GrowthSnapshot } from './growth';
import { Progress, type ProgressSnapshot } from './progress';

/**
 * セーブデータ（M6-2。ADR-033。設計は docs/07 §3.4）の形と、読み書きの変換。純粋関数（localStorage に触るのは src/platform/storage.ts）。
 * バージョン番号 + 移行関数: データの構造を変えても古いセーブを壊さない（MIGRATIONS[n] は version n → n + 1 に変える）。
 * 保存するのは成長（レベル・経験値・ポイント・ステータス・スキルのレベル）とスキル欄の選択、挑戦の進み具合（クリアした段階・選んでいる段階。版 2 から）だけ。
 * 戦闘の途中の状態（敵・体力・アイテム）は保存しない（闘技場は 1 回ごとの挑戦。アイテムの持ち越しはダンジョンができてから）。
 */

export const SAVE_VERSION = 2;

export interface SaveData extends GrowthSnapshot {
  version: number;
  /** 武器の系統ごとの、スキルボタンで使うスキル */
  selected: Partial<Record<WeaponId, SkillId>>;
  /** 挑戦の進み具合（版 2。ADR-036） */
  progress: ProgressSnapshot;
}

/** 古い版を 1 つ新しい版へ変える関数（MIGRATIONS[n] は版 n → n + 1）。入力は検証前の JSON */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // 版 1 → 2: 挑戦の進み具合（段階）が加わった。まだ何もクリアしていない扱い
  1: (raw) => ({ ...raw, version: 2, progress: { cleared: 0, tier: 1 } }),
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * localStorage から読んだものを、いまの版の SaveData にする。壊れている・読めない・新しすぎる版なら null（セーブなしとして始める）。
 * 数値の範囲は Growth が丸める（ここでは型だけを確かめる）
 */
export function parseSave(raw: unknown): SaveData | null {
  if (!isRecord(raw)) return null;
  let cur: Record<string, unknown> = raw;
  let version = typeof cur.version === 'number' ? Math.floor(cur.version) : 0;
  if (version < 1 || version > SAVE_VERSION) return null;
  while (version < SAVE_VERSION) {
    const m = MIGRATIONS[version];
    if (!m) return null;
    cur = m(cur);
    version++;
  }
  const num = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  const stats = {} as Record<StatId, number>;
  const rawStats = isRecord(cur.stats) ? cur.stats : {};
  for (const id of STAT_IDS) stats[id] = num(rawStats[id], 5);
  const skills = {} as Record<SkillId, number>;
  const rawSkills = isRecord(cur.skills) ? cur.skills : {};
  for (const id of SKILL_ORDER) skills[id] = num(rawSkills[id], 1);
  const selected: Partial<Record<WeaponId, SkillId>> = {};
  const rawSel = isRecord(cur.selected) ? cur.selected : {};
  for (const fam of ['sword', 'greatsword'] as const) {
    const v = rawSel[fam];
    // 選んだスキルが（消えた・別の系統になったなどで）使えないなら、選んでいないことにする
    if (isSkillId(v) && SKILLS[v].family === fam) selected[fam] = v;
  }
  const rawProgress = isRecord(cur.progress) ? cur.progress : {};
  const progress = new Progress({ cleared: num(rawProgress.cleared, 0), tier: num(rawProgress.tier, 1) }).toSnapshot();
  return {
    version: SAVE_VERSION,
    level: num(cur.level, 1),
    xp: num(cur.xp, 0),
    statPoints: num(cur.statPoints, 0),
    skillPoints: num(cur.skillPoints, 0),
    stats,
    skills,
    selected,
    progress,
  };
}

/** 成長・スキル欄の選択・挑戦の進み具合から、保存するデータを作る */
export function makeSave(growth: Growth, selected: Partial<Record<WeaponId, SkillId>>, progress: Progress = new Progress()): SaveData {
  return { version: SAVE_VERSION, ...growth.toSnapshot(), selected: { ...selected }, progress: progress.toSnapshot() };
}
