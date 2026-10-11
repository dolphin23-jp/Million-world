import { describe, expect, it } from 'vitest';
import { ATTACKS, CHARGES, resolveAttack } from './data/attacks';
import { GREATSWORD_MOVESET, SPEAR_MOVESET, SWORD_MOVESET, type Moveset } from './data/moveset';

/**
 * 通常攻撃の連携の長さ（ADR-047）: 片手剣は最大 7 連、大剣は最大 5 連。
 * 連携は「始動の技から、受付で押す入力（連打 = next / スティックの前・横・後ろ = branches）で続く木」で、技ごとに親は 1 つ（continueFrom が親の受付の姿勢を指す）。
 */

type Input = 'tap' | 'forward' | 'side' | 'back';

/** id の技から、入力 input で続く技（無ければ undefined） */
function follow(id: string, input: Input): string | undefined {
  const a = ATTACKS[id]!;
  return input === 'tap' ? a.next : a.branches?.[input];
}

/** 始動の技（装備の技のセットと、溜めを放つ技）から続く木の中で、いちばん長い連なり（技の id の列と、続ける入力の列） */
function longest(starts: readonly string[]): { ids: string[]; inputs: Input[] } {
  let best = { ids: [] as string[], inputs: [] as Input[] };
  const walk = (ids: string[], inputs: Input[]): void => {
    if (ids.length > best.ids.length) best = { ids, inputs };
    const a = ATTACKS[ids[ids.length - 1]!]!;
    const links: [Input, string | undefined][] = [['tap', a.next], ['forward', a.branches?.forward], ['side', a.branches?.side], ['back', a.branches?.back]];
    for (const [input, to] of links) if (to !== undefined) walk([...ids, to], [...inputs, input]);
  };
  for (const s of starts) walk([s], []);
  return best;
}

const startsOf = (m: Moveset, chargeId: string): string[] => {
  const c = CHARGES[chargeId]!;
  return [m.light, m.lunge, m.retreat, m.sweep, m.dashRoll, m.dashBack, c.next, ...(c.levelNext ?? []).filter((v): v is string => v !== undefined)];
};

describe('連携の長さ（ADR-047）', () => {
  it('片手剣は最大 7 連: 袈裟 → 逆袈裟 → 突き →（前）打ち上げ → 落下斬り →（前）地擦り斬り上げ → 燕返し。ロックなしでも出せる（前と連打だけ）', () => {
    const best = longest(startsOf(SWORD_MOVESET, 'sword'));
    expect(best.ids).toEqual(['combo1', 'combo2', 'combo3', 'comboUpper', 'comboSlam', 'slamRip', 'swallow']);
    expect(best.inputs).toEqual(['tap', 'tap', 'forward', 'tap', 'forward', 'tap']);
  });

  it('大剣は最大 5 連: 袈裟 → 逆袈裟 →（前）叩き落とし →（前）跳ね上げ → 大叩き割り。ロックなしでも出せる（前と連打だけ）', () => {
    const best = longest(startsOf(GREATSWORD_MOVESET, 'greatsword'));
    expect(best.ids).toEqual(['gs1', 'gs2', 'gsDrop', 'gsBounce', 'gsCrush']);
    expect(best.inputs).toEqual(['tap', 'forward', 'forward', 'tap']);
  });

  it('槍は最大 5 連: 突き → 二段突き → 薙ぎ払い →（前）貫き突き → 回し払い。ロックなしでも出せる（前と連打だけ）', () => {
    const best = longest(startsOf(SPEAR_MOVESET, 'spear'));
    expect(best.ids).toEqual(['sp1', 'sp2', 'sp3', 'spPierce', 'spTwirl']);
    expect(best.inputs).toEqual(['tap', 'tap', 'forward', 'tap']);
  });

  it('入力ごとの連携の道（技表の木と同じ）。どの 1 歩も、続く技が実在してその入力で出る', () => {
    // [始動の技, ...[入力, 続く技]]
    const routes: [string, ...[Input, string][]][] = [
      // 片手剣
      ['combo1', ['tap', 'combo2'], ['tap', 'combo3']],
      ['combo1', ['tap', 'combo2'], ['tap', 'combo3'], ['forward', 'comboUpper'], ['tap', 'comboSlam'], ['forward', 'slamRip'], ['tap', 'swallow']],
      ['combo1', ['tap', 'combo2'], ['side', 'comboSpin'], ['side', 'spinRev'], ['tap', 'spinRise']],
      ['combo1', ['back', 'comboHop'], ['forward', 'hopThrust']],
      ['sweep', ['tap', 'sweepBack']],
      ['lunge', ['tap', 'lungeSlash']],
      // 大剣
      ['gs1', ['tap', 'gs2'], ['forward', 'gsDrop'], ['forward', 'gsBounce'], ['tap', 'gsCrush']],
      ['gs1', ['side', 'gsSpin2'], ['side', 'gsSpin3'], ['forward', 'gsSpinSlam']],
      ['gsLunge', ['tap', 'gsLungeSweep'], ['tap', 'gsReturnSweep']],
      ['gsRetreat', ['forward', 'gsRetreatLunge']],
      ['gsRise', ['tap', 'gsRiseSlam']],
      ['gsHeavy', ['tap', 'gsHeavyRip']],
      // 槍
      ['sp1', ['tap', 'sp2'], ['tap', 'sp3'], ['forward', 'spPierce'], ['tap', 'spTwirl']],
      ['sp1', ['side', 'spUpper']],
    ];
    for (const [start, ...steps] of routes) {
      let id = start;
      for (const [input, to] of steps) {
        expect(follow(id, input), `${id} → ${input}`).toBe(to);
        id = to;
      }
    }
  });

  it('スティックの横・後ろで続く技は、ロック中だけ出る（ロックなしでは倒せば前になる）。7 連と 5 連の最長は前と連打だけで届く', () => {
    for (const [m, c] of [[SWORD_MOVESET, 'sword'], [GREATSWORD_MOVESET, 'greatsword'], [SPEAR_MOVESET, 'spear']] as const) {
      const best = longest(startsOf(m, c));
      expect(best.inputs.every((i) => i === 'tap' || i === 'forward')).toBe(true);
    }
  });

  it('どの技も、連携の中で続く元（親）は 1 つだけ（木。親の受付の姿勢から続くクリップが 1 本に決まる）', () => {
    const parents = new Map<string, string[]>();
    for (const a of Object.values(ATTACKS)) {
      for (const to of [a.next, ...Object.values(a.branches ?? {})]) {
        if (to !== undefined) parents.set(to, [...(parents.get(to) ?? []), a.id]);
      }
    }
    for (const [to, from] of parents) expect(from, `${to} の親`).toHaveLength(1);
  });

  it('連携の締め（7 連の燕返し・5 連の大叩き割りなど）には続きが無い', () => {
    for (const id of ['swallow', 'gsCrush', 'spinRise', 'gsSpinSlam', 'gsReturnSweep']) {
      const a = ATTACKS[id]!;
      expect(a.next, id).toBeUndefined();
      expect(a.branches, id).toBeUndefined();
    }
  });

  it('連携の締めは、その前の技より重い（威力。多段は窓の倍率の合計）', () => {
    const total = (id: string): number => {
      const a = ATTACKS[id]!;
      return a.windows ? a.windows.reduce((s, w) => s + a.damage * (w.damageScale ?? 1), 0) : a.damage;
    };
    expect(total('swallow')).toBeGreaterThan(total('slamRip'));
    expect(total('spinRise')).toBeGreaterThan(total('spinRev'));
    expect(ATTACKS.gsCrush!.damage).toBeGreaterThan(ATTACKS.gsBounce!.damage);
    expect(ATTACKS.gsSpinSlam!.damage).toBeGreaterThan(ATTACKS.gsSpin3!.damage);
    // 大剣の締めは、溜め斬り以下（溜めのほうが強い）
    expect(ATTACKS.gsCrush!.damage).toBeLessThanOrEqual(ATTACKS.gsHeavy!.damage);
  });

  it('燕返しは、1 つ目の太刀の窓が終わってから回避でやめられる（2 つ目の窓の前）。当たりの窓は 2 つで、2 つ目のほうが強い', () => {
    const f = resolveAttack(ATTACKS.swallow!);
    expect(f.windows).toHaveLength(2);
    expect(f.dodgeCancel).toBeGreaterThanOrEqual(f.windows[0]!.end);
    expect(f.dodgeCancel).toBeLessThan(f.windows[1]!.start);
    expect(f.windows[1]!.def.damageScale!).toBeGreaterThan(f.windows[0]!.def.damageScale!);
  });
});
