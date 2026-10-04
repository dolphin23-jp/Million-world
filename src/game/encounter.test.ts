import { describe, expect, it } from 'vitest';
import { Encounter, rankOf, spawnPoint, type EncounterEvent } from './encounter';
import { DEMO_ENCOUNTER, RANKS, type EncounterDef } from '../ai/data/encounters';

const DEF: EncounterDef = {
  waves: [[{ type: 'imp', offset: 0, radius: 6 }], [{ type: 'imp', offset: 0, radius: 6 }, { type: 'imp', offset: 1, radius: 6 }]],
  waveGapFrames: 10,
  victoryDelayFrames: 5,
  defeatDelayFrames: 8,
  maxAttackers: 2,
};

/** n フレーム進め、出たイベントを集める */
function run(e: Encounter, n: number, alive: number, playerDead = false): EncounterEvent[] {
  const out: EncounterEvent[] = [];
  for (let i = 0; i < n; i++) {
    const ev = e.step(alive, playerDead);
    if (ev) out.push(ev);
  }
  return out;
}

describe('Encounter', () => {
  it('最初のステップで 1 波目を出す', () => {
    const e = new Encounter(DEF);
    expect(e.step(0, false)).toEqual({ type: 'spawn', wave: 0, first: true, last: false });
    expect(e.wave).toBe(0);
    expect(e.onLastWave).toBe(false);
  });

  it('敵がいるあいだは進まない。全滅させて waveGapFrames 待つと次の波が出る', () => {
    const e = new Encounter(DEF);
    e.step(0, false);
    expect(run(e, 50, 1)).toEqual([]);
    const evs = run(e, DEF.waveGapFrames, 0);
    expect(evs).toEqual([{ type: 'spawn', wave: 1, first: false, last: true }]);
    expect(e.onLastWave).toBe(true);
  });

  it('待ちの途中で敵が出れば（数え直し）、waveGapFrames は最初から', () => {
    const e = new Encounter(DEF);
    e.step(0, false);
    run(e, DEF.waveGapFrames - 1, 0);
    run(e, 1, 1); // 敵が 1 体いる（待ちが戻る）
    expect(run(e, DEF.waveGapFrames - 1, 0)).toEqual([]);
    expect(run(e, 1, 0)).toHaveLength(1);
  });

  it('最後の波を全滅させて victoryDelayFrames 経つと victory。そのあとは何も起きない', () => {
    const e = new Encounter(DEF);
    e.step(0, false);
    run(e, DEF.waveGapFrames, 0); // 2 波目
    expect(run(e, DEF.victoryDelayFrames - 1, 0)).toEqual([]);
    expect(run(e, 1, 0)).toEqual([{ type: 'end', phase: 'victory' }]);
    expect(e.phase).toBe('victory');
    expect(e.ended).toBe(true);
    expect(run(e, 100, 0)).toEqual([]);
  });

  it('プレイヤーが倒れて defeatDelayFrames 経つと defeat（敵が全滅していても）', () => {
    const e = new Encounter(DEF);
    e.step(0, false);
    run(e, DEF.waveGapFrames, 0);
    expect(run(e, DEF.defeatDelayFrames - 1, 0, true)).toEqual([]);
    expect(run(e, 1, 0, true)).toEqual([{ type: 'end', phase: 'defeat' }]);
    expect(e.phase).toBe('defeat');
  });

  it('倒れているあいだは次の波が出ない', () => {
    const e = new Encounter(DEF);
    e.step(0, false);
    expect(run(e, 7, 0, true)).toEqual([]);
    expect(e.wave).toBe(0);
  });

  it('経過フレームは戦闘中だけ数える（終わったら止まる）', () => {
    const e = new Encounter(DEF);
    e.step(0, false);
    run(e, DEF.waveGapFrames, 0);
    run(e, DEF.victoryDelayFrames, 0);
    const f = e.frames;
    run(e, 50, 0);
    expect(e.frames).toBe(f);
  });

  it('リザルトの集計: 撃破数・被弾・時間・評価。戦闘中は null、負けたら評価なし', () => {
    const e = new Encounter(DEF);
    expect(e.result()).toBeNull();
    e.step(0, false);
    e.onKill();
    e.onKill();
    e.onPlayerHit(12);
    run(e, 59, 1);
    run(e, DEF.waveGapFrames, 0);
    run(e, DEF.victoryDelayFrames, 0);
    const r = e.result()!;
    expect(r.phase).toBe('victory');
    expect(r.kills).toBe(2);
    expect(r.hitsTaken).toBe(1);
    expect(r.damageTaken).toBe(12);
    expect(r.seconds).toBeCloseTo(e.frames / 60, 9);
    expect(r.rank).toBe('S');

    const d = new Encounter(DEF);
    d.step(0, false);
    run(d, DEF.defeatDelayFrames, 1, true);
    expect(d.result()!.phase).toBe('defeat');
    expect(d.result()!.rank).toBeNull();
  });

  it('デモの構成: 波があり、最後の波を含む。敵の数は 2 → 3、攻撃権は 1 以上', () => {
    expect(DEMO_ENCOUNTER.waves.map((w) => w.length)).toEqual([2, 6, 2, 3, 7]);
    expect(DEMO_ENCOUNTER.maxAttackers).toBeGreaterThanOrEqual(1);
  });
});

describe('rankOf', () => {
  it('時間も被ダメージも上限以下の最初のランク。両方が効く', () => {
    const s = RANKS[0];
    expect(rankOf(s.maxSeconds, s.maxDamage)).toBe('S');
    expect(rankOf(s.maxSeconds + 1, 0)).not.toBe('S'); // 遅い
    expect(rankOf(10, s.maxDamage + 1)).not.toBe('S'); // 食らいすぎ
    expect(rankOf(1e6, 1e6)).toBe('C');
  });

  it('ランクは S → A → B の順に基準が緩くなる', () => {
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i]!.maxSeconds).toBeGreaterThan(RANKS[i - 1]!.maxSeconds);
      expect(RANKS[i]!.maxDamage).toBeGreaterThan(RANKS[i - 1]!.maxDamage);
    }
  });
});

describe('spawnPoint', () => {
  const w = (offset: number, radius = 6) => ({ type: 'imp' as const, offset, radius });

  it('プレイヤーが中心にいるときは +Z の側が基準（offset 0）', () => {
    const p = spawnPoint(w(0), 0, 0, 14);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(6, 9);
  });

  it('プレイヤーが縁にいるとき、反対側（アリーナの中心の向こう）に出る', () => {
    const p = spawnPoint(w(0), 10, 0, 14); // プレイヤーは +X の縁。向こうは −X
    expect(p.x).toBeCloseTo(-6, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it('offset で左右に散る（反時計回りが正）。距離は radius のまま', () => {
    const a = spawnPoint(w(0.5), 0, 0, 14);
    const b = spawnPoint(w(-0.5), 0, 0, 14);
    expect(a.x).toBeLessThan(0);
    expect(b.x).toBeGreaterThan(0);
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(6, 9);
    expect(Math.hypot(b.x, b.z)).toBeCloseTo(6, 9);
  });

  it('アリーナの縁の内側（半径 − 1.5）に収める', () => {
    const p = spawnPoint(w(0, 20), 0, 0, 14);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(12.5, 9);
  });
});

describe('Encounter: ガード・パリィの集計', () => {
  it('ガードで受けた削りダメージは被ダメージに入るが、被弾の回数には数えない。パリィは回数を数える', () => {
    const e = new Encounter(DEF);
    e.step(0, false);
    e.onPlayerHit(12);
    e.onPlayerGuard(2);
    e.onPlayerGuard(6);
    e.onParry();
    e.onParry();
    expect(e.hitsTaken).toBe(1);
    expect(e.damageTaken).toBe(20);
    expect(e.parries).toBe(2);
    run(e, DEF.defeatDelayFrames, 0, true);
    const r = e.result()!;
    expect(r.parries).toBe(2);
    expect(r.hitsTaken).toBe(1);
    expect(r.damageTaken).toBe(20);
  });
});
