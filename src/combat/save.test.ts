import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, makeSave, parseSave } from './save';
import { Growth } from './growth';
import { totalXpTo } from './data/growth';
import { SkillBook } from './skills';
import { SKILL_ORDER } from './data/skills';
import { Progress } from './progress';

function sample(): Growth {
  const g = new Growth();
  g.addXp(totalXpTo(6) + 12);
  g.addStat('str');
  g.addStat('str');
  g.addStat('int');
  g.addSkill('yotsuba');
  g.addSkill('issen');
  return g;
}

describe('セーブデータ', () => {
  it('作って JSON を通して読むと、同じ成長に戻る', () => {
    const g = sample();
    const text = JSON.stringify(makeSave(g, { sword: 'samidare', greatsword: 'issen' }));
    const data = parseSave(JSON.parse(text));
    expect(data).not.toBeNull();
    expect(data!.version).toBe(SAVE_VERSION);
    expect(new Growth(data!).toSnapshot()).toEqual(g.toSnapshot());
    expect(data!.selected).toEqual({ sword: 'samidare', greatsword: 'issen' });
  });
  it('読めないもの・版が無い・新しすぎる版は null（セーブなしとして始める）', () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave(undefined)).toBeNull();
    expect(parseSave('abc')).toBeNull();
    expect(parseSave(42)).toBeNull();
    expect(parseSave([])).toBeNull();
    expect(parseSave({})).toBeNull();
    expect(parseSave({ version: 0, level: 5 })).toBeNull();
    expect(parseSave({ version: SAVE_VERSION + 1, level: 5 })).toBeNull();
  });
  it('足りない項目は初期値で補い、型の違うものは無視する', () => {
    const d = parseSave({ version: SAVE_VERSION, level: 4, stats: { str: 'many', dex: 7 }, skills: null, selected: 'x' });
    expect(d).not.toBeNull();
    expect(d!.level).toBe(4);
    expect(d!.stats.str).toBe(5);
    expect(d!.stats.dex).toBe(7);
    for (const id of SKILL_ORDER) expect(d!.skills[id]).toBe(1);
    expect(d!.selected).toEqual({});
  });
  it('スキルの選択は、存在するスキルで系統が合うものだけ残す', () => {
    const d = parseSave({ version: SAVE_VERSION, level: 1, selected: { sword: 'issen', greatsword: 'issen' } });
    expect(d!.selected).toEqual({ greatsword: 'issen' });
    expect(parseSave({ version: SAVE_VERSION, selected: { sword: 'nonexistent' } })!.selected).toEqual({});
  });
  it('書き換えられた数値でも、Growth に渡せば壊れない（範囲を丸め、合わなければ振り分けを戻す）', () => {
    const d = parseSave({ version: SAVE_VERSION, level: 3, statPoints: 0, stats: { str: 999, dex: 5, agi: 5, int: 5, vit: 5 } })!;
    const g = new Growth(d);
    expect(g.stat('str')).toBe(5);
    expect(g.statPoints).toBe(6);
  });
  it('SkillBook の選択を保存して戻せる', () => {
    const a = new SkillBook();
    a.select('tatsumaki');
    a.select('houzan');
    const sel = a.selection();
    expect(sel).toEqual({ sword: 'tatsumaki', greatsword: 'houzan' });
    const b = new SkillBook();
    b.restoreSelection(parseSave({ version: SAVE_VERSION, selected: sel })!.selected);
    expect(b.selectedFor('sword')!.id).toBe('tatsumaki');
    expect(b.selectedFor('greatsword')!.id).toBe('houzan');
  });
});

describe('挑戦の進み具合（版 2。ADR-036）', () => {
  it('版は 2。進み具合（クリアした段階・選んでいる段階）が往復する', () => {
    expect(SAVE_VERSION).toBe(2);
    const prog = new Progress({ cleared: 2, tier: 3 });
    const data = parseSave(JSON.parse(JSON.stringify(makeSave(new Growth(), {}, prog))))!;
    expect(data.progress).toEqual({ cleared: 2, tier: 3 });
    expect(new Progress(data.progress).toSnapshot()).toEqual(prog.toSnapshot());
  });
  it('makeSave に進み具合を渡さなければ、何もクリアしていない扱い', () => {
    expect(makeSave(new Growth(), {}).progress).toEqual({ cleared: 0, tier: 1 });
  });
  it('版 1 のセーブは、成長をそのまま引き継ぎ、進み具合は初期（何もクリアしていない）に移行する', () => {
    const v1 = { version: 1, level: 5, xp: 10, statPoints: 6, skillPoints: 3, stats: { str: 7, dex: 5, agi: 5, int: 5, vit: 5 }, skills: { yotsuba: 2 }, selected: { sword: 'samidare' } };
    const d = parseSave(v1)!;
    expect(d).not.toBeNull();
    expect(d.version).toBe(SAVE_VERSION);
    expect(d.level).toBe(5);
    expect(d.stats.str).toBe(7);
    expect(d.selected).toEqual({ sword: 'samidare' });
    expect(d.progress).toEqual({ cleared: 0, tier: 1 });
  });
  it('進み具合が壊れていても、読める範囲に丸める（解放していない段階を選んでいたら戻す）', () => {
    expect(parseSave({ version: 2, progress: 'x' })!.progress).toEqual({ cleared: 0, tier: 1 });
    expect(parseSave({ version: 2, progress: { cleared: 1, tier: 4 } })!.progress).toEqual({ cleared: 1, tier: 2 });
    expect(parseSave({ version: 2, progress: { cleared: 'a', tier: null } })!.progress).toEqual({ cleared: 0, tier: 1 });
    expect(parseSave({ version: 2 })!.progress).toEqual({ cleared: 0, tier: 1 });
  });
});
