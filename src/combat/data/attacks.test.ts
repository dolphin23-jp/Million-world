import { describe, expect, it } from 'vitest';
import { ATTACKS, DODGE, dodgeRoot, resolveAttack, rootMotionOf } from './attacks';
import { AuthoredSampler } from '../../character/authoring';
import { AUTHORED_ATTACKS } from '../../character/data/authored';
import { HERO } from '../../character/data/hero';
import { makeRig } from '../../character/test-rig';

describe('resolveAttack', () => {
  it('秒を rate で割って 60Hz フレームに変換する', () => {
    const f = resolveAttack({
      id: 't',
      segment: 't',
      segmentDuration: 1.0,
      activeStart: 0.5,
      activeEnd: 0.6,
      cancelAt: 0.8,
      trail: [0.4, 0.7],
      rate: 2,
      lunge: 0,
      hitbox: { kind: 'arc', range: 1, halfAngle: 1 },
      damage: 1,
      hitStop: 0,
      knockback: 0,
    });
    expect(f.startup).toBe(15);
    expect(f.active).toBe(3);
    expect(f.recovery).toBe(12);
    expect(f.total).toBe(30);
    expect(f.cancelFrame).toBe(24);
  });

  it('cancelFrame は持続終了より前にならない', () => {
    const f = resolveAttack({ ...ATTACKS.combo1!, cancelAt: 0 });
    expect(f.cancelFrame).toBeGreaterThanOrEqual(f.startup + f.active);
  });

  it('定義済みの攻撃はすべて 発生 ≥ 8f, 持続 ≥ 3f, 全体 ≤ 60f', () => {
    for (const a of Object.values(ATTACKS)) {
      const f = resolveAttack(a);
      expect(f.startup, a.id).toBeGreaterThanOrEqual(8);
      expect(f.active, a.id).toBeGreaterThanOrEqual(3);
      expect(f.total, a.id).toBeLessThanOrEqual(60);
      expect(f.startup + f.active + f.recovery).toBe(f.total);
    }
  });

  it('コンボの連鎖が終端で止まる', () => {
    let a = ATTACKS.combo1!;
    const seen = new Set<string>();
    while (a.next) {
      expect(seen.has(a.id)).toBe(false);
      seen.add(a.id);
      a = ATTACKS[a.next]!;
    }
    expect(a.id).toBe('combo3');
  });

  it('攻撃が参照するアニメ区間（Meshy の切り出し）／手付けクリップが存在し、長さが segmentDuration と一致する', () => {
    const segs: Record<string, { start: number; end: number }> = HERO.segments;
    for (const a of Object.values(ATTACKS)) {
      if (a.authored) {
        expect(AUTHORED_ATTACKS[a.segment], `${a.id} の手付けクリップ ${a.segment}`).toBe(a.authored);
        expect(a.authored.name, a.id).toBe(a.segment);
        expect(a.authored.duration, a.id).toBeCloseTo(a.segmentDuration, 6);
      } else {
        const seg = segs[a.segment];
        expect(seg, `${a.id} の区間 ${a.segment}`).toBeDefined();
        expect(seg!.end - seg!.start, a.id).toBeCloseTo(a.segmentDuration, 2);
      }
      // 当たり判定は区間の中、次段の受付は持続の終わり以降
      expect(a.activeStart, a.id).toBeGreaterThanOrEqual(0);
      expect(a.activeEnd, a.id).toBeLessThanOrEqual(a.segmentDuration);
    }
  });

  it('手付けのコンボは前の技の受付時点から続いている（continueFrom が前の技のクリップと cancelAt を指す）', () => {
    let a = ATTACKS.combo1!;
    let chained = 0;
    while (a.next) {
      const n = ATTACKS[a.next]!;
      const cf = n.authored?.continueFrom;
      expect(cf, `${n.id} は ${a.id} から続く手付け`).toBeDefined();
      expect(cf!.attack, n.id).toBe(a.authored);
      expect(cf!.t, n.id).toBeCloseTo(a.cancelAt, 6);
      chained++;
      a = n;
    }
    expect(chained).toBe(2);
  });

  it('手付けの攻撃の前進は rootZ のカーブに従い、単調に進んで終端で止まる', () => {
    const a = ATTACKS.combo1!;
    const root = rootMotionOf(a)!;
    expect(root).toBeTypeOf('function');
    expect(root(0)).toBe(0);
    let prev = 0;
    for (let f = 1; f <= Math.round(a.segmentDuration * 60); f++) {
      const z = root(f / 60);
      expect(z).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = z;
    }
    expect(root(a.segmentDuration)).toBeCloseTo(0.57, 6);
    // 手付けでない攻撃（lunge で進む）は rootMotionOf が null
    const { authored: _authored, ...plain } = ATTACKS.combo3!;
    expect(rootMotionOf(plain)).toBeNull();
  });

  it('重撃は単発（次段なし）の手付けで、踏み込み 0.81m。持続は剣が前を通る最高速の前後', () => {
    const a = ATTACKS.heavy!;
    expect(a.next).toBeUndefined();
    expect(a.authored).toBe(AUTHORED_ATTACKS.heavy);
    expect(a.authored!.continueFrom).toBeUndefined();
    expect(rootMotionOf(a)!(a.segmentDuration)).toBeCloseTo(0.81, 6);
    const f = resolveAttack(a);
    // 重撃は軽い連撃より発生が遅い代わりに威力が大きい
    expect(f.startup).toBeGreaterThan(resolveAttack(ATTACKS.combo1!).startup);
    expect(a.damage).toBeGreaterThan(ATTACKS.combo3!.damage);
  });
});

describe('DODGE（手付けのダッシュ）', () => {
  it('クリップは手付けとして登録され、長さがフレーム数と一致する', () => {
    expect(AUTHORED_ATTACKS.dodge).toBe(DODGE.clip);
    expect(DODGE.clip.name).toBe('dodge');
    expect(DODGE.frames).toBe(Math.ceil(DODGE.clip.duration * 60));
  });

  it('無敵とキャンセルのフレームが全体の中に収まり、無敵が先、キャンセルが後', () => {
    expect(DODGE.invulnStart).toBeGreaterThanOrEqual(0);
    expect(DODGE.invulnStart).toBeLessThan(DODGE.invulnEnd);
    expect(DODGE.invulnEnd).toBeLessThan(DODGE.cancelFrame);
    expect(DODGE.cancelFrame).toBeLessThan(DODGE.frames);
  });

  it('前進は単調で、滑らかに加速して終端で止まり、最高速は 12 m/s 以下', () => {
    expect(dodgeRoot(0)).toBe(0);
    let prev = 0;
    let prevV = 0;
    let peak = 0;
    for (let f = 1; f <= DODGE.frames; f++) {
      const z = dodgeRoot(f / 60);
      const v = (z - prev) * 60;
      expect(z, `f${f}`).toBeGreaterThanOrEqual(prev - 1e-12);
      // 1 フレームで 6 m/s を超えて急変しない（滑らかな加減速）
      expect(Math.abs(v - prevV), `f${f}`).toBeLessThan(6);
      peak = Math.max(peak, v);
      prev = z;
      prevV = v;
    }
    expect(dodgeRoot(DODGE.clip.duration)).toBeCloseTo(3.1, 6);
    expect(peak).toBeLessThanOrEqual(12);
    expect(peak).toBeGreaterThan(8);
    // 最後の 1 フレームはほぼ止まっている
    expect(prevV).toBeLessThan(0.5);
  });
});

describe('踏み込み（手付けの下半身）', () => {
  const rig = makeRig();
  const sampler = (id: string) => new AuthoredSampler(rig, ATTACKS[id]!.authored!);

  it('軽い連撃は 0.45m 以上、重撃は 0.7m 以上前へ進む（踏み込みが足りない、に戻さない）', () => {
    const total = (id: string) => rootMotionOf(ATTACKS[id]!)!(ATTACKS[id]!.segmentDuration);
    for (const id of ['combo1', 'combo2', 'combo3']) expect(total(id), id).toBeGreaterThanOrEqual(0.45);
    expect(total('heavy')).toBeGreaterThanOrEqual(0.7);
  });

  it('着地の瞬間に、踏み込む足が腰（ルート）より 0.25m 以上前にある。着地の足は床の上', () => {
    // [攻撃, 踏み込む足, 着地の秒]（着地は剣が体の前を通る最高速の直前）
    const plants: [string, 'footL' | 'footR', number][] = [
      ['combo1', 'footL', 0.235],
      ['combo2', 'footR', 0.16],
      ['combo3', 'footR', 0.17],
      ['heavy', 'footR', 0.5],
    ];
    for (const [id, foot, t] of plants) {
      const s = sampler(id);
      const p = s.sample(t, s.newInput());
      expect(p[foot].z - s.rootZ(t), `${id} の着地`).toBeGreaterThanOrEqual(0.25);
      expect(p[foot].lift, `${id} の着地の足は床の上`).toBeCloseTo(0, 6);
      // 剣が体の前を通る前に着く（着地 ≦ 持続の中心）
      const a = ATTACKS[id]!;
      expect(t, id).toBeLessThanOrEqual((a.activeStart + a.activeEnd) / 2 + 1e-9);
    }
  });

  it('受付（cancelAt）から先はルートが止まる（遅めに押しても pose と位置がずれない）', () => {
    for (const a of Object.values(ATTACKS)) {
      if (!a.next) continue;
      const root = rootMotionOf(a)!;
      expect(root(a.cancelAt), a.id).toBeCloseTo(root(a.segmentDuration), 9);
    }
  });

  it('次段の始まりの足は、前の技の受付時点の足の位置と世界で一致する（足の z + 原点の付け替え）', () => {
    for (const id of ['combo1', 'combo2']) {
      const prev = ATTACKS[id]!;
      const next = ATTACKS[prev.next!]!;
      const sp = sampler(id);
      const sn = sampler(next.id);
      const before = sp.sample(prev.cancelAt, sp.newInput());
      const after = sn.sample(0, sn.newInput());
      const originShift = sp.rootZ(prev.cancelAt);
      expect(after.footL.z + originShift, `${next.id} の左足`).toBeCloseTo(before.footL.z, 6);
      expect(after.footR.z + originShift, `${next.id} の右足`).toBeCloseTo(before.footR.z, 6);
    }
  });

  it('次段の始まりの 1 フレームは足が動かない（前の技から受け取る足の位置と、最初の保持キーの値が合っている）', () => {
    for (const id of ['combo2', 'combo3']) {
      const s = sampler(id);
      const a = s.sample(0, s.newInput());
      const b = s.sample(1 / 60, s.newInput());
      expect(b.footL.z, `${id} の左足`).toBeCloseTo(a.footL.z, 6);
      expect(b.footR.z, `${id} の右足`).toBeCloseTo(a.footR.z, 6);
    }
  });
});

describe('剣筋（trail）の区間', () => {
  it('すべての攻撃で、区間が動画の長さの中にあり、持続フレームを含む', () => {
    for (const a of Object.values(ATTACKS)) {
      const [start, end] = a.trail;
      expect(start, a.id).toBeGreaterThanOrEqual(0);
      expect(end, a.id).toBeLessThanOrEqual(a.segmentDuration);
      expect(start, a.id).toBeLessThan(a.activeStart);
      expect(end, a.id).toBeGreaterThan(a.activeEnd);
    }
  });
});
