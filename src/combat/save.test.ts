import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, makeSave, parseSave } from './save';
import { Growth } from './growth';
import { totalXpTo } from './data/growth';
import { SkillBook } from './skills';
import { SKILL_ORDER } from './data/skills';

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
