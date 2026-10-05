import { describe, expect, it } from 'vitest';
import { SKILLS, SKILL_LEVEL_MAX, SKILL_ORDER, type SkillDef, type SkillId } from './data/skills';
import { SkillBook, skillCooldown, skillInfo, skillPower, skillSteps, stepAttackAt } from './skills';
import { resolveAttack } from './data/attacks';
import { SKILL_ATTACKS, findAttack } from './data/skill-attacks';

const SWORD = SKILL_ORDER.filter((id) => SKILLS[id].family === 'sword');
const GREAT = SKILL_ORDER.filter((id) => SKILLS[id].family === 'greatsword');

const LEVELS = Array.from({ length: SKILL_LEVEL_MAX }, (_, i) => i + 1);
/** そのスキルがレベル lv で使う連なり（進化の差し替え後の攻撃 id） */
const chainAt = (id: SkillId, lv: number): string[] => skillSteps(SKILLS[id], lv).map((s) => s.attack);
/** そのスキルが取りうる攻撃 id すべて（元の段 + 進化先） */
const allAttackIds = (id: SkillId): string[] => {
  const out = new Set<string>();
  for (const s of SKILLS[id].steps) {
    out.add(s.attack);
    for (const e of s.evolve ?? []) out.add(e.attack);
  }
  return [...out];
};

describe('スキルのデータの整合', () => {
  it('武器の系統ごとの剣技の数（第 2 弾のあと。ADR-038）: 片手剣 6・大剣 5。名前（一覧）の順は系統ごとにまとまる', () => {
    expect(SWORD.length).toBe(6);
    expect(GREAT.length).toBe(5);
    // 一覧（SKILL_ORDER）は片手剣が先、大剣があと（系統の途中で入れ替わらない）
    const fam = SKILL_ORDER.map((id) => SKILLS[id].family);
    expect(fam.join()).toBe([...fam].sort((a, b) => (a === b ? 0 : a === 'sword' ? -1 : 1)).join());
  });

  it('id・名前は重複せず、ボタンに出す短い表記は 4 文字まで', () => {
    expect(new Set(SKILL_ORDER).size).toBe(SKILL_ORDER.length);
    expect(Object.keys(SKILLS).sort()).toEqual([...SKILL_ORDER].sort());
    const names = SKILL_ORDER.map((id) => SKILLS[id].name);
    expect(new Set(names).size).toBe(names.length);
    for (const id of SKILL_ORDER) {
      expect(SKILLS[id].id).toBe(id);
      expect(SKILLS[id].short.length).toBeLessThanOrEqual(4);
    }
  });

  it('連なりの攻撃 id（進化の差し替え先も）はすべて実在し（ATTACKS か SKILL_ATTACKS）、武器の系統と合っている（大剣の技は両手持ち）', () => {
    for (const id of SKILL_ORDER) {
      const def = SKILLS[id];
      expect(def.steps.length).toBeGreaterThanOrEqual(1);
      for (const aid of allAttackIds(id)) {
        const a = findAttack(aid);
        expect(a, `${id}: ${aid}`).toBeTruthy();
        expect(a!.authored, `${id}: ${aid} は手付け`).toBeTruthy();
        expect(a!.authored!.twoHanded !== undefined, `${id}: ${aid}`).toBe(def.family === 'greatsword');
      }
    }
  });

  it('どのレベルの連なりでも、隣り合う 2 つは後ろの手付けが前の技の受付時点（cancelAt）の姿勢から続く（continueFrom）= 進化しても姿勢のつなぎ目が自然', () => {
    for (const id of SKILL_ORDER) {
      for (const lv of LEVELS) {
        const chain = chainAt(id, lv);
        for (let i = 0; i + 1 < chain.length; i++) {
          const a = findAttack(chain[i]!)!;
          const b = findAttack(chain[i + 1]!)!;
          const cf = b.authored!.continueFrom;
          expect(cf, `${id} Lv${lv}: ${a.id} → ${b.id} の continueFrom`).toBeDefined();
          expect(cf!.attack, `${id} Lv${lv}: ${a.id} → ${b.id}`).toBe(a.authored);
          expect(cf!.t, `${id} Lv${lv}: ${a.id} → ${b.id} の受付の時刻`).toBeCloseTo(a.cancelAt, 6);
        }
      }
    }
  });

  it('次の段へ移れる受付（cancelFrame）と回避のキャンセル（dodgeCancel）は、全体の中にあり、受付は持続（当たり）が終わったあと', () => {
    for (const id of SKILL_ORDER) {
      for (const aid of allAttackIds(id)) {
        const a = findAttack(aid)!;
        const fr = resolveAttack(a);
        expect(fr.cancelFrame, `${id}: ${aid}`).toBeGreaterThanOrEqual(fr.startup + fr.active);
        expect(fr.dodgeCancel, `${id}: ${aid}`).toBeLessThanOrEqual(fr.total);
        expect(fr.dodgeCancel, `${id}: ${aid}`).toBeGreaterThan(0);
      }
    }
  });

  it('多段の技の窓は時間順で重ならず、窓の範囲が activeStart〜activeEnd と一致し、クリップの長さの中にある', () => {
    for (const id of SKILL_ORDER) {
      for (const aid of allAttackIds(id)) {
        const a = findAttack(aid)!;
        if (!a.windows) continue;
        let prevEnd = -1;
        for (const w of a.windows) {
          expect(w.start, `${id}: ${aid}`).toBeGreaterThanOrEqual(prevEnd);
          expect(w.end, `${id}: ${aid}`).toBeGreaterThan(w.start);
          prevEnd = w.end;
        }
        expect(a.activeStart, `${id}: ${aid}`).toBeCloseTo(a.windows[0]!.start, 6);
        expect(a.activeEnd, `${id}: ${aid}`).toBeCloseTo(a.windows[a.windows.length - 1]!.end, 6);
        expect(a.activeEnd, `${id}: ${aid}`).toBeLessThanOrEqual(a.segmentDuration);
      }
    }
  });

  it('窓のグループ（同じ群は 1 回の当たり = 1 度だけ）は窓の順に 0 から連番で、echoes（余波の輪）は当たりの後ろの時刻にある', () => {
    for (const id of SKILL_ORDER) {
      for (const aid of allAttackIds(id)) {
        const a = findAttack(aid)!;
        if (a.windows) {
          let prev = 0;
          for (const w of a.windows) {
            const g = w.group ?? 0;
            expect(g, `${id}: ${aid}`).toBeGreaterThanOrEqual(prev);
            expect(g - prev, `${id}: ${aid} の群の番号は 1 ずつ`).toBeLessThanOrEqual(1);
            prev = g;
          }
        }
        const fr = resolveAttack(a);
        for (const im of fr.impacts) {
          expect(im.frame, `${id}: ${aid} の接地の衝撃`).toBeGreaterThan(0);
          expect(im.frame, `${id}: ${aid} の接地の衝撃`).toBeLessThanOrEqual(fr.total);
        }
      }
    }
  });

  it('SKILL_ATTACKS に、どのスキルからも使われない攻撃は残っていない（作って忘れた定義の掃除）', () => {
    const used = new Set<string>(SKILL_ORDER.flatMap(allAttackIds));
    for (const aid of Object.keys(SKILL_ATTACKS)) expect(used.has(aid), aid).toBe(true);
  });

  it('剣技は 3 つ以上の当たりがあるもの（連なりの段 + 窓の数）が少なくとも 1 本ある。段の解放レベルは先頭が 1 で、後ろへ向けて単調に増える', () => {
    const hits = (def: SkillDef): number => def.steps.reduce((n, s) => n + (findAttack(s.attack)!.windows?.length ?? 1), 0);
    expect(SKILL_ORDER.some((id) => hits(SKILLS[id]) >= 3)).toBe(true);
    for (const id of SKILL_ORDER) {
      const steps = SKILLS[id].steps;
      expect(steps[0]!.minLevel ?? 1).toBe(1);
      let prev = 1;
      for (const s of steps) {
        const lv = s.minLevel ?? 1;
        expect(lv).toBeGreaterThanOrEqual(prev);
        expect(lv).toBeLessThanOrEqual(SKILL_LEVEL_MAX);
        prev = lv;
      }
    }
  });

  it('レベルが上がるほど威力は増え、クールダウンは短くなる（0 にはならない）', () => {
    for (const id of SKILL_ORDER) {
      const def = SKILLS[id];
      for (let lv = 2; lv <= SKILL_LEVEL_MAX; lv++) {
        expect(skillPower(def, lv)).toBeGreaterThan(skillPower(def, lv - 1));
        expect(skillCooldown(def, lv)).toBeLessThan(skillCooldown(def, lv - 1));
      }
      expect(skillCooldown(def, SKILL_LEVEL_MAX)).toBeGreaterThan(60);
    }
  });
});

describe('skillSteps: レベルで連なりが伸びる', () => {
  /** 段の解放レベルの仕組みを確かめる合成のスキル */
  const synth: SkillDef = {
    id: SKILL_ORDER[0]!,
    name: 't',
    short: 't',
    detail: '',
    family: 'sword',
    steps: [{ attack: 'a' }, { attack: 'b' }, { attack: 'c', minLevel: 3 }, { attack: 'd', minLevel: 5, scale: 1.1 }],
    power: 1.2,
    powerPerLevel: 0.1,
    cooldownFrames: 600,
    cooldownPerLevel: 0.05,
  };

  it('Lv1 で 2 段、Lv3 で 3 段、Lv5 で 4 段', () => {
    expect(skillSteps(synth, 1).map((s) => s.attack)).toEqual(['a', 'b']);
    expect(skillSteps(synth, 2).length).toBe(2);
    expect(skillSteps(synth, 3).map((s) => s.attack)).toEqual(['a', 'b', 'c']);
    expect(skillSteps(synth, 5).map((s) => s.attack)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('段の威力 = スキルの威力 × 段の倍率', () => {
    const steps = skillSteps(synth, 5);
    expect(steps[0]!.power).toBeCloseTo(1.2 + 0.1 * 4);
    expect(steps[3]!.power).toBeCloseTo((1.2 + 0.1 * 4) * 1.1);
  });

  it('cooldown の倍率（INT など）が掛かる', () => {
    expect(skillCooldown(synth, 1, 0.5)).toBe(300);
    expect(skillCooldown(synth, 3)).toBe(Math.round(600 * 0.9));
  });

  it('進化（evolve）: 段の攻撃が、満たしている中でいちばん高いレベルのものに差し替わる。段の数・威力は変わらない', () => {
    const evo: SkillDef = {
      ...synth,
      steps: [{ attack: 'a', evolve: [{ minLevel: 4, attack: 'a4' }, { minLevel: 7, attack: 'a7' }] }, { attack: 'b', minLevel: 2, evolve: [{ minLevel: 7, attack: 'b7' }] }],
    };
    expect(skillSteps(evo, 1).map((s) => s.attack)).toEqual(['a']);
    expect(skillSteps(evo, 3).map((s) => s.attack)).toEqual(['a', 'b']);
    expect(skillSteps(evo, 4).map((s) => s.attack)).toEqual(['a4', 'b']);
    expect(skillSteps(evo, 6).map((s) => s.attack)).toEqual(['a4', 'b']);
    expect(skillSteps(evo, 7).map((s) => s.attack)).toEqual(['a7', 'b7']);
    expect(skillSteps(evo, 10).map((s) => s.attack)).toEqual(['a7', 'b7']);
    expect(skillSteps(evo, 7)[0]!.power).toBeCloseTo(skillSteps(evo, 3)[0]!.power + 0.1 * 4, 9);
    // evolve の並びが昇順でなくても、いちばん高い minLevel が勝つ
    const rev: SkillDef = { ...synth, steps: [{ attack: 'a', evolve: [{ minLevel: 7, attack: 'a7' }, { minLevel: 4, attack: 'a4' }] }] };
    expect(stepAttackAt(rev.steps[0]!, 5)).toBe('a4');
    expect(stepAttackAt(rev.steps[0]!, 9)).toBe('a7');
    expect(stepAttackAt(rev.steps[0]!, 1)).toBe('a');
  });
});

describe('剣技の進化（Lv4 と Lv7 だけ。ADR-034・038）', () => {
  it('モーション（連なりの攻撃 id）が変わるのは Lv3→4 と Lv6→7 の 2 回だけ。そのほかのレベルアップでは同じ連なりで数値だけが伸びる', () => {
    for (const id of SKILL_ORDER) {
      const changed: number[] = [];
      for (let lv = 2; lv <= SKILL_LEVEL_MAX; lv++) {
        if (chainAt(id, lv).join() !== chainAt(id, lv - 1).join()) changed.push(lv);
      }
      expect(changed, id).not.toEqual([]);
      for (const lv of changed) expect([4, 7], `${id} Lv${lv}`).toContain(lv);
    }
  });

  it('剣技ごとの連なり（Lv1 / Lv4 / Lv7）', () => {
    expect(chainAt('yotsuba', 1)).toEqual(['skQuad1', 'skQuad2', 'skQuad3', 'skQuad4']);
    expect(chainAt('yotsuba', 4)).toEqual(['skQuad1', 'skQuad2', 'skQuad3', 'skQuad4', 'skQuad5']);
    expect(chainAt('yotsuba', 7)).toEqual(['skQuad1', 'skQuad2', 'skQuad3', 'skQuad4', 'skQuad5', 'skQuad6']);
    expect(chainAt('samidare', 1)).toEqual(['skFlurry']);
    expect(chainAt('samidare', 4)).toEqual(['skFlurry7']);
    expect(chainAt('samidare', 7)).toEqual(['skFlurry9']);
    expect(chainAt('tatsumaki', 1)).toEqual(['skWhirl']);
    expect(chainAt('tatsumaki', 4)).toEqual(['skWhirl35']);
    expect(chainAt('tatsumaki', 7)).toEqual(['skWhirl45']);
    expect(chainAt('houzan', 1)).toEqual(['skGsSweep1', 'skGsSweep2', 'skGsSlam']);
    expect(chainAt('houzan', 4)).toEqual(['skGsSweep1', 'skGsSweep2', 'skGsSlamLeap']);
    expect(chainAt('houzan', 7)).toEqual(['skGsSweep1', 'skGsSweep2', 'skGsSlamLeap', 'skGsRip']);
    expect(chainAt('issen', 1)).toEqual(['skGsIssen']);
    expect(chainAt('issen', 4)).toEqual(['skGsIssen', 'skGsIssen2']);
    expect(chainAt('issen', 7)).toEqual(['skGsIssen', 'skGsIssen2', 'skGsIssenLunge']);
    // 第 2 弾（ADR-038）: どれも 1 本のクリップが Lv4・Lv7 で長い版に替わる
    expect(chainAt('iai', 1)).toEqual(['skIai']);
    expect(chainAt('iai', 4)).toEqual(['skIai4']);
    expect(chainAt('iai', 7)).toEqual(['skIai7']);
    expect(chainAt('juji', 1)).toEqual(['skCross']);
    expect(chainAt('juji', 4)).toEqual(['skCross2']);
    expect(chainAt('juji', 7)).toEqual(['skCross3']);
    expect(chainAt('hayate', 1)).toEqual(['skGale']);
    expect(chainAt('hayate', 4)).toEqual(['skGale6']);
    expect(chainAt('hayate', 7)).toEqual(['skGale8']);
    expect(chainAt('ouzu', 1)).toEqual(['skOuzu']);
    expect(chainAt('ouzu', 4)).toEqual(['skOuzu3']);
    expect(chainAt('ouzu', 7)).toEqual(['skOuzu4']);
    expect(chainAt('kenzan', 1)).toEqual(['skKenzan']);
    expect(chainAt('kenzan', 4)).toEqual(['skKenzan4']);
    expect(chainAt('kenzan', 7)).toEqual(['skKenzan5']);
    expect(chainAt('hiryu', 1)).toEqual(['skHiryu']);
    expect(chainAt('hiryu', 4)).toEqual(['skHiryu4']);
    expect(chainAt('hiryu', 7)).toEqual(['skHiryu7']);
  });

  it('進化のたびに、当たり（窓の数 + 段）は減らない = 進化は必ず「増える・派手になる」', () => {
    const hits = (id: SkillId, lv: number): number => chainAt(id, lv).reduce((n, a) => n + (findAttack(a)!.windows?.length ?? 1), 0);
    for (const id of SKILL_ORDER) {
      expect(hits(id, 4), id).toBeGreaterThanOrEqual(hits(id, 1));
      expect(hits(id, 7), id).toBeGreaterThanOrEqual(hits(id, 4));
      expect(hits(id, 7), id).toBeGreaterThan(hits(id, 1));
    }
  });

  it('進化の説明（evolutions）は Lv4 と Lv7 の 2 件', () => {
    for (const id of SKILL_ORDER) {
      const ev = SKILLS[id].evolutions;
      expect(ev, id).toBeDefined();
      expect(ev!.map((e) => e.level)).toEqual([4, 7]);
      for (const e of ev!) expect(e.text.length, `${id} Lv${e.level}`).toBeGreaterThan(4);
    }
  });
});

describe('SkillBook', () => {
  it('最初は全スキル Lv1。その系統で使えるものだけが並ぶ', () => {
    const b = new SkillBook();
    for (const id of SKILL_ORDER) expect(b.level(id)).toBe(1);
    expect(b.available('sword').map((d) => d.id)).toEqual(SWORD);
    expect(b.available('greatsword').map((d) => d.id)).toEqual(GREAT);
  });

  it('選んでいなければ系統の最初のスキル。select で替わり、系統ごとに別々に覚えている', () => {
    const b = new SkillBook();
    expect(b.selectedFor('sword')!.id).toBe(SWORD[0]);
    expect(b.select(SWORD[1]!)).toBe(true);
    expect(b.selectedFor('sword')!.id).toBe(SWORD[1]);
    expect(b.selectedFor('greatsword')!.id).toBe(GREAT[0]);
    b.select(GREAT[1]!);
    expect(b.selectedFor('sword')!.id).toBe(SWORD[1]);
    expect(b.selectedFor('greatsword')!.id).toBe(GREAT[1]);
  });

  it('レベル 0 のスキルは使えず、選べない。選んでいたものがレベル 0 になったら最初のものへ戻る', () => {
    const b = new SkillBook({ [SWORD[0]!]: 0 });
    expect(b.available('sword').map((d) => d.id)).not.toContain(SWORD[0]);
    expect(b.select(SWORD[0]!)).toBe(false);
    expect(b.selectedFor('sword')!.id).toBe(SWORD[1]);
    b.select(SWORD[2]!);
    b.setLevel(SWORD[2]!, 0);
    expect(b.selectedFor('sword')!.id).toBe(SWORD[1]);
    const none = new SkillBook(Object.fromEntries(GREAT.map((id) => [id, 0])));
    expect(none.selectedFor('greatsword')).toBeNull();
    expect(none.prepare('greatsword')).toBeNull();
    expect(none.cycle('greatsword')).toBeNull();
  });

  it('cycle: 使えるスキルを順に回る', () => {
    const b = new SkillBook();
    const seen: SkillId[] = [];
    for (let i = 0; i < SWORD.length + 2; i++) seen.push(b.cycle('sword', 1)!.id);
    const expected: SkillId[] = [];
    for (let i = 1; i <= SWORD.length + 2; i++) expected.push(SWORD[i % SWORD.length]!);
    expect(seen).toEqual(expected);
    expect(b.cycle('sword', -1)!.id).toBe(SWORD[(SWORD.length + 2 - 1) % SWORD.length]);
  });

  it('prepare は選んでいるスキルの連なりを返し、クールダウンには入らない。start でクールダウンに入り、step で明ける', () => {
    const b = new SkillBook();
    const first = SWORD[0]!;
    const run = b.prepare('sword')!;
    expect(run.skill).toBe(first);
    expect(run.steps.map((s) => s.attack)).toEqual(skillSteps(SKILLS[first], 1).map((s) => s.attack));
    expect(b.ready(first)).toBe(true);
    expect(b.prepare('sword')).not.toBeNull(); // 使っていない = まだ使える
    b.start(first);
    expect(b.ready(first)).toBe(false);
    expect(b.cooldownRatio(first)).toBe(1);
    expect(b.prepare('sword')).toBeNull();
    const cd = skillCooldown(SKILLS[first], 1);
    for (let i = 0; i < cd - 1; i++) b.step();
    expect(b.ready(first)).toBe(false);
    expect(b.cooldownRatio(first)).toBeGreaterThan(0);
    b.step();
    expect(b.ready(first)).toBe(true);
    expect(b.cooldownRatio(first)).toBe(0);
  });

  it('スキルごとに別々のクールダウン', () => {
    const b = new SkillBook();
    b.start(SWORD[0]!);
    expect(b.ready(SWORD[1]!)).toBe(true);
    b.select(SWORD[1]!);
    expect(b.prepare('sword')!.skill).toBe(SWORD[1]);
  });

  it('レベルが上がるとクールダウンが短くなる', () => {
    const id = SWORD[1]!;
    const b = new SkillBook({ [id]: SKILL_LEVEL_MAX });
    b.start(id);
    const lv5 = Math.round(SKILLS[id].cooldownFrames * (1 - SKILLS[id].cooldownPerLevel * (SKILL_LEVEL_MAX - 1)));
    for (let i = 0; i < lv5; i++) b.step();
    expect(b.ready(id)).toBe(true);
  });

  it('serial は一覧に効く変化（レベル・選択）だけで増え、クールダウンの減りでは増えない', () => {
    const b = new SkillBook();
    const id = SWORD[0]!;
    b.select(id); // 未選択（最初のもの）からの選び直しは増える
    const s1 = b.serial;
    b.select(id);
    expect(b.serial).toBe(s1);
    b.start(id);
    b.step();
    expect(b.serial).toBe(s1);
    b.setLevel(id, 3);
    expect(b.serial).toBeGreaterThan(s1);
  });

  it('reset はクールダウンだけ消し、レベルと選択は残す', () => {
    const b = new SkillBook();
    const id = SWORD[2]!;
    b.select(id);
    b.setLevel(id, 4);
    b.start(id);
    b.reset();
    expect(b.ready(id)).toBe(true);
    expect(b.level(id)).toBe(4);
    expect(b.selectedFor('sword')!.id).toBe(id);
  });
});

describe('画面に出すスキルの数値（skillInfo）と選択のクリア', () => {
  it('レベルが上がるほど威力が伸び、クールダウンが縮み、連なりは伸びる（または同じ）', () => {
    for (const id of SKILL_ORDER) {
      const def = SKILLS[id];
      let prev = skillInfo(def, 1);
      for (let lv = 2; lv <= SKILL_LEVEL_MAX; lv++) {
        const cur = skillInfo(def, lv);
        expect(cur.power, `${id} Lv${lv}`).toBeGreaterThan(prev.power);
        expect(cur.cooldownSec, `${id} Lv${lv}`).toBeLessThan(prev.cooldownSec);
        expect(cur.steps, `${id} Lv${lv}`).toBeGreaterThanOrEqual(prev.steps);
        prev = cur;
      }
    }
  });
  it('数値はなめらかに伸びる（Lv10 でも威力 +45%・クールダウン −31.5% 前後）', () => {
    const def = SKILLS.yotsuba;
    const a = skillInfo(def, 1);
    const b = skillInfo(def, SKILL_LEVEL_MAX);
    expect(b.power / a.power).toBeGreaterThan(1.3);
    expect(b.power / a.power).toBeLessThan(1.5);
    expect(b.cooldownSec / a.cooldownSec).toBeGreaterThan(0.6);
    expect(b.cooldownSec / a.cooldownSec).toBeLessThan(0.75);
  });
  it('選択をクリアすると、系統の最初のスキルに戻る', () => {
    const b = new SkillBook();
    b.select('tatsumaki');
    expect(b.selectedFor('sword')!.id).toBe('tatsumaki');
    b.clearSelection();
    expect(b.selectedFor('sword')!.id).toBe(SKILL_ORDER.find((id) => SKILLS[id].family === 'sword'));
    expect(b.selection()).toEqual({});
  });
});
