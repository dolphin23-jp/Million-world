/**
 * 成長（M6-2。ADR-033。設計は docs/07-progression-and-world.md §3）の数値。経験値の曲線・レベルごとのポイント・上限。
 * ステータスの効き方は stats.ts、スキルのレベルの上限は skills.ts（SKILL_LEVEL_MAX）。
 */
export const GROWTH = {
  /** キャラクターのレベルの上限（内容が増えたら伸ばす） */
  levelMax: 30,
  /** レベルが上がるごとにもらえるポイント（本人の指示: ステ振り 3・スキル 1） */
  statPointsPerLevel: 3,
  skillPointsPerLevel: 1,
  /** 次のレベルまでに要る経験値 = round(xpBase × level ^ xpExp)。デモ 1 周（約 660）で Lv7 前後、5 周で Lv15 前後 */
  xpBase: 27,
  xpExp: 1.1,
} as const;

/** レベル level から level + 1 へ上がるのに要る経験値（上限のレベルでは 0） */
export function xpToNext(level: number): number {
  if (level >= GROWTH.levelMax) return 0;
  return Math.round(GROWTH.xpBase * Math.max(1, level) ** GROWTH.xpExp);
}

/** レベル 1 から level へ上がるまでの経験値の合計（目安の表示・テスト用） */
export function totalXpTo(level: number): number {
  let s = 0;
  for (let l = 1; l < Math.min(level, GROWTH.levelMax); l++) s += xpToNext(l);
  return s;
}
