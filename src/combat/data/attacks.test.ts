import { describe, expect, it } from 'vitest';
import { ATTACKS, CHARGES, DODGE, DODGES, resolveAttack, rootMotionOf } from './attacks';
import { GREATSWORD_MOVESET, SWORD_MOVESET } from './moveset';
import { GS_DODGE, GS_DODGE_BACK, GS_STANCE } from '../../character/data/greatsword';
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

  it('定義済みの攻撃はすべて 発生 ≥ 8f, 持続 ≥ 3f, 全体 ≤ 72f（最大まで溜めた地割りだけが 60f を超える長い硬直）', () => {
    for (const a of Object.values(ATTACKS)) {
      const f = resolveAttack(a);
      expect(f.startup, a.id).toBeGreaterThanOrEqual(8);
      expect(f.active, a.id).toBeGreaterThanOrEqual(3);
      expect(f.total, a.id).toBeLessThanOrEqual(72);
      if (a.id !== 'gsSmash') expect(f.total, a.id).toBeLessThanOrEqual(60);
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

  it('重撃は単発（次段なし）の手付けで、溜めの構えの終端から続き、踏み込み 0.81m。持続は剣が前を通る最高速の前後', () => {
    const a = ATTACKS.heavy!;
    expect(a.next).toBeUndefined();
    expect(a.authored).toBe(AUTHORED_ATTACKS.heavy);
    // 溜めの終端（HEAVY_CHARGE の最後の姿勢）から続けて始まる
    expect(a.authored!.continueFrom?.attack).toBe(AUTHORED_ATTACKS.heavyCharge);
    expect(a.authored!.continueFrom?.t).toBeCloseTo(AUTHORED_ATTACKS.heavyCharge!.duration, 9);
    expect(rootMotionOf(a)!(a.segmentDuration)).toBeCloseTo(0.81, 6);
    const f = resolveAttack(a);
    // 重撃は溜め（長押し）が予備動作なので、放ってからの発生は軽い 1 段目より短い。代わりに威力が大きい
    expect(f.startup).toBeLessThan(resolveAttack(ATTACKS.combo1!).startup);
    expect(a.damage).toBeGreaterThan(ATTACKS.combo3!.damage);
  });
});

describe('回避（手付け。ロールと後ろステップ）', () => {
  it('クリップは手付けとして登録され、長さがフレーム数と一致する', () => {
    expect(AUTHORED_ATTACKS.dodge).toBe(DODGES.roll.clip);
    expect(AUTHORED_ATTACKS.dodgeBack).toBe(DODGES.back.clip);
    expect(DODGE).toBe(DODGES.roll);
    for (const d of Object.values(DODGES)) expect(d.frames, d.id).toBe(Math.ceil(d.clip.duration * 60));
  });

  it('無敵とキャンセルのフレームが全体の中に収まり、無敵が先、キャンセルが後', () => {
    for (const d of Object.values(DODGES)) {
      expect(d.invulnStart, d.id).toBeGreaterThanOrEqual(0);
      expect(d.invulnStart, d.id).toBeLessThan(d.invulnEnd);
      expect(d.invulnEnd, d.id).toBeLessThan(d.cancelFrame);
      expect(d.cancelFrame, d.id).toBeLessThan(d.frames);
    }
  });

  it('ロールの前進は単調で、滑らかに加速して終端で止まり、最高速は 12 m/s 以下', () => {
    const d = DODGES.roll;
    expect(d.root(0)).toBe(0);
    let prev = 0;
    let prevV = 0;
    let peak = 0;
    for (let f = 1; f <= d.frames; f++) {
      const z = d.root(f / 60);
      const v = (z - prev) * 60;
      expect(z, `f${f}`).toBeGreaterThanOrEqual(prev - 1e-12);
      // 1 フレームで 6 m/s を超えて急変しない（滑らかな加減速）
      expect(Math.abs(v - prevV), `f${f}`).toBeLessThan(6);
      peak = Math.max(peak, v);
      prev = z;
      prevV = v;
    }
    expect(d.root(d.clip.duration)).toBeCloseTo(2.95, 6);
    expect(peak).toBeLessThanOrEqual(12);
    expect(peak).toBeGreaterThan(6);
    // 最後の 1 フレームはほぼ止まっている
    expect(prevV).toBeLessThan(0.5);
  });

  it('後ろステップは後ろへ（負）単調に進み、合計 2.0m、最高速は 12 m/s 以下で、終端で止まる', () => {
    const d = DODGES.back;
    expect(d.root(0)).toBe(0);
    let prev = 0;
    let prevV = 0;
    let peak = 0;
    for (let f = 1; f <= d.frames; f++) {
      const z = d.root(f / 60);
      const v = (z - prev) * 60;
      expect(z, `f${f}`).toBeLessThanOrEqual(prev + 1e-12);
      expect(Math.abs(v - prevV), `f${f}`).toBeLessThan(6);
      peak = Math.max(peak, -v);
      prev = z;
      prevV = v;
    }
    expect(d.root(d.clip.duration)).toBeCloseTo(-2.0, 6);
    expect(peak).toBeLessThanOrEqual(12);
    expect(peak).toBeGreaterThan(6);
    expect(Math.abs(prevV)).toBeLessThan(0.5);
  });

  it('ロールの無敵は着地の寸前（足が地面に戻る前）まで: 無敵の終わりは足が着く 0.43s より前', () => {
    expect(DODGES.roll.invulnEnd / 60).toBeLessThan(0.43);
    expect(DODGES.back.invulnEnd / 60).toBeLessThan(0.3);
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
      ['heavy', 'footR', 0.18],
      // 大剣（幅の広い踏み込み）
      ['gs1', 'footL', 0.37],
      ['gs2', 'footR', 0.21],
      ['gsLunge', 'footR', 0.35],
      ['gsRise', 'footR', 0.23],
      ['gsHeavy', 'footL', 0.22],
      ['gsSmash', 'footL', 0.3],
      ['gsDrop', 'footL', 0.24],
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
      if (!a.next && !a.branches) continue;
      const root = rootMotionOf(a)!;
      expect(root(a.cancelAt), a.id).toBeCloseTo(root(a.segmentDuration), 9);
    }
  });

  it('次段（普通の続きも分岐も）の始まりの足は、前の技の受付時点の足の位置と世界で一致する（足の z + 原点の付け替え）', () => {
    const pairs: [string, string][] = [];
    for (const a of Object.values(ATTACKS)) {
      if (a.next) pairs.push([a.id, a.next]);
      for (const to of Object.values(a.branches ?? {})) pairs.push([a.id, to]);
    }
    expect(pairs.length).toBe(8); // 普通の続き 3 + 分岐 5
    for (const [from, to] of pairs) {
      const prev = ATTACKS[from]!;
      const next = ATTACKS[to]!;
      const sp = sampler(from);
      const sn = sampler(to);
      const before = sp.sample(prev.cancelAt, sp.newInput());
      const after = sn.sample(0, sn.newInput());
      const originShift = sp.rootZ(prev.cancelAt);
      expect(after.footL.z + originShift, `${next.id} の左足`).toBeCloseTo(before.footL.z, 6);
      expect(after.footR.z + originShift, `${next.id} の右足`).toBeCloseTo(before.footR.z, 6);
    }
  });

  it('次段の始まりの 1 フレームは足が動かない（前の技から受け取る足の位置と、最初の保持キーの値が合っている）', () => {
    for (const id of ['combo2', 'combo3', 'gs2', 'comboHop', 'comboSpin', 'comboUpper', 'gsSpin2', 'gsDrop']) {
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

describe('溜め（長押し）の定義', () => {
  const c = CHARGES.sword!;

  it('構えのクリップは手付けとして登録され、フレーム数がクリップの長さと一致する。放つ攻撃は存在する', () => {
    expect(AUTHORED_ATTACKS.heavyCharge).toBe(c.clip);
    expect(c.frames).toBe(Math.ceil(c.clip.duration * 60));
    expect(ATTACKS[c.next]).toBeDefined();
    expect(ATTACKS[c.next]!.authored!.continueFrom?.attack).toBe(c.clip);
  });

  it('段階は昇順で、威力の倍率は段階ごとに上がる（長さ = 段階数 + 1）。最大保持は最高段階より長い', () => {
    expect(c.levelPower).toHaveLength(c.levels.length + 1);
    for (let i = 1; i < c.levels.length; i++) expect(c.levels[i]!, `levels[${i}]`).toBeGreaterThan(c.levels[i - 1]!);
    for (let i = 1; i < c.levelPower.length; i++) expect(c.levelPower[i]!, `levelPower[${i}]`).toBeGreaterThan(c.levelPower[i - 1]!);
    expect(c.levelPower[0]).toBe(1);
    expect(c.maxHoldFrames).toBeGreaterThan(c.levels[c.levels.length - 1]!);
  });

  it('溜めに入るフレームは、構えのクリップが 1 段目から続く時刻と一致し、1 段目の斬りが始まる前', () => {
    const from = c.clip.continueFrom!;
    expect(from.attack).toBe(ATTACKS[SWORD_MOVESET.light]!.authored);
    expect(c.holdFrames).toBe(Math.round(from.t * 60));
    expect(c.holdFrames).toBeLessThan(resolveAttack(ATTACKS[SWORD_MOVESET.light]!).startup);
  });
});

describe('大剣の技（手付け・両手持ち。ADR-021）', () => {
  const gsIds = Object.values(GREATSWORD_MOVESET)
    .concat('gs2', CHARGES.greatsword!.next, 'gsSpin2', 'gsDrop', 'gsSmash')
    .filter((v, i, a) => a.indexOf(v) === i);

  it('技のセットはすべて実在し、手付けクリップとして登録された両手持ち（twoHanded）で、長さが segmentDuration と一致する', () => {
    for (const id of gsIds) {
      const a = ATTACKS[id]!;
      expect(a, id).toBeDefined();
      expect(a.authored, id).toBeDefined();
      expect(AUTHORED_ATTACKS[a.segment], id).toBe(a.authored);
      expect(a.authored!.twoHanded, id).toBeDefined();
      expect(a.authored!.continueFrom, `${id} は構えか前の技の姿勢から続く`).toBeDefined();
      expect(a.authored!.duration, id).toBeCloseTo(a.segmentDuration, 6);
    }
  });

  it('1 段目 → 2 段目で終わる（手数が少ない）。2 段目は 1 段目の受付時点の姿勢から続く', () => {
    let a = ATTACKS[GREATSWORD_MOVESET.light]!;
    const chain = [a.id];
    while (a.next) {
      const n = ATTACKS[a.next]!;
      expect(n.authored!.continueFrom!.attack, n.id).toBe(a.authored);
      expect(n.authored!.continueFrom!.t, n.id).toBeCloseTo(a.cancelAt, 6);
      chain.push(n.id);
      a = n;
    }
    expect(chain).toEqual(['gs1', 'gs2']);
  });

  it('ロール直後・後ろステップ直後の技は、それぞれの回避（大剣版）の受付の姿勢から続く', () => {
    const dash = ATTACKS[GREATSWORD_MOVESET.dashRoll]!;
    const rise = ATTACKS[GREATSWORD_MOVESET.dashBack]!;
    expect(dash.authored!.continueFrom!.attack).toBe(GS_DODGE);
    expect(rise.authored!.continueFrom!.attack).toBe(GS_DODGE_BACK);
    // 回避のキャンセル（攻撃を出せる）フレームの時刻に合っている
    expect(dash.authored!.continueFrom!.t).toBeCloseTo(DODGES.roll.cancelFrame / 60, 1);
    expect(rise.authored!.continueFrom!.t).toBeCloseTo(DODGES.back.cancelFrame / 60, 1);
  });

  it('大剣のロールは、ルートの前進・長さが片手剣のロールと同じ（sim の移動・無敵はそのクリップの数値に従うので、見た目とずれない）', () => {
    for (const [gs, sword] of [[GS_DODGE, DODGES.roll.clip], [GS_DODGE_BACK, DODGES.back.clip]] as const) {
      expect(gs.duration).toBeCloseTo(sword.duration, 9);
      const root = rootMotionOf({ ...ATTACKS.combo1!, id: gs.name, authored: gs })!;
      const swordRoot = rootMotionOf({ ...ATTACKS.combo1!, id: sword.name, authored: sword })!;
      for (let f = 0; f <= Math.round(sword.duration * 60); f++) expect(root(f / 60), `${gs.name} f${f}`).toBeCloseTo(swordRoot(f / 60), 9);
    }
    expect(AUTHORED_ATTACKS[GS_DODGE.name]).toBe(GS_DODGE);
    expect(AUTHORED_ATTACKS[GS_DODGE_BACK.name]).toBe(GS_DODGE_BACK);
    expect(AUTHORED_ATTACKS[GS_STANCE.name]).toBe(GS_STANCE);
  });

  it('片手剣の同種の技より重い: 発生が遅く、ダメージ・ヒットストップ・ノックバックが大きい', () => {
    const pairs: [string, string][] = [
      ['gs1', 'combo1'],
      ['gs2', 'combo2'],
      ['gsLunge', 'lunge'],
      ['gsRetreat', 'retreat'],
      ['gsSpin', 'sweep'],
      ['gsDash', 'dash'],
      ['gsRise', 'lunge'],
      ['gsHeavy', 'heavy'],
    ];
    for (const [gs, sw] of pairs) {
      const a = ATTACKS[gs]!;
      const b = ATTACKS[sw]!;
      expect(resolveAttack(a).startup, `${gs} の発生`).toBeGreaterThan(resolveAttack(b).startup);
      expect(a.damage, `${gs} のダメージ`).toBeGreaterThan(b.damage);
      expect(a.hitStop, `${gs} のヒットストップ`).toBeGreaterThanOrEqual(b.hitStop);
      expect(a.knockback, `${gs} のノックバック`).toBeGreaterThanOrEqual(b.knockback);
    }
  });

  it('範囲が広い: 扇の技は片手剣より届く距離が長く、半角が広い。突きの線も長い。大回転は全方位', () => {
    const arc = (id: string) => {
      const h = ATTACKS[id]!.hitbox;
      if (h.kind !== 'arc') throw new Error(`${id} は扇ではない`);
      return h;
    };
    for (const [gs, sw] of [['gs1', 'combo1'], ['gs2', 'combo2'], ['gsRetreat', 'retreat'], ['gsSpin', 'sweep'], ['gsHeavy', 'heavy']] as const) {
      expect(arc(gs).range, gs).toBeGreaterThan(arc(sw).range);
      expect(arc(gs).halfAngle, gs).toBeGreaterThan(arc(sw).halfAngle);
    }
    const line = (id: string) => {
      const h = ATTACKS[id]!.hitbox;
      if (h.kind !== 'line') throw new Error(`${id} は線ではない`);
      return h;
    };
    expect(line('gsLunge').length).toBeGreaterThan(line('lunge').length);
    expect(arc('gsSpin').halfAngle).toBeGreaterThanOrEqual(Math.PI);
  });

  it('スーパーアーマーを割れる重さ: 子鬼の armorBreakDamage（30）以上は 2 段目・大回転・跳び叩きつけ・叩き落とし・溜め斬り・地割り', () => {
    const breakers = gsIds.filter((id) => ATTACKS[id]!.damage >= 30).sort();
    expect(breakers).toEqual(['gs2', 'gsDash', 'gsDrop', 'gsHeavy', 'gsSmash', 'gsSpin']);
  });

  it('溜め: 構えは 1 段目の予備動作の途中から続き、押し続ける長さは構えのクリップが続く時刻と一致する。段階の威力は片手剣より大きく伸びる', () => {
    const c = CHARGES.greatsword!;
    const from = c.clip.continueFrom!;
    expect(from.attack).toBe(ATTACKS[GREATSWORD_MOVESET.light]!.authored);
    expect(c.holdFrames).toBe(Math.round(from.t * 60));
    expect(c.holdFrames).toBeLessThan(resolveAttack(ATTACKS[GREATSWORD_MOVESET.light]!).startup);
    expect(c.frames).toBe(Math.ceil(c.clip.duration * 60));
    expect(ATTACKS[c.next]!.authored!.continueFrom!.attack).toBe(c.clip);
    expect(c.levelPower).toHaveLength(c.levels.length + 1);
    expect(c.levelPower[c.levelPower.length - 1]).toBeGreaterThan(CHARGES.sword!.levelPower[CHARGES.sword!.levelPower.length - 1]!);
    expect(c.maxHoldFrames).toBeGreaterThan(c.levels[c.levels.length - 1]!);
  });
});

describe('コンボの分岐（スティックの向きで続きが変わる。ADR-023）', () => {
  const sources = Object.values(ATTACKS).filter((a) => a.branches);

  it('分岐のある技は、片手剣の 1〜3 段目と大剣の 1〜2 段目', () => {
    expect(sources.map((a) => a.id).sort()).toEqual(['combo1', 'combo2', 'combo3', 'gs1', 'gs2']);
  });

  it('分岐先は実在する手付けで、前の技の受付時点（cancelAt）の姿勢から続く（continueFrom）。受付は技の途中にある', () => {
    for (const a of sources) {
      expect(a.cancelAt, `${a.id} の受付`).toBeLessThan(a.segmentDuration);
      expect(a.cancelAt, `${a.id} の受付は持続の後`).toBeGreaterThanOrEqual(a.activeEnd);
      for (const [dir, to] of Object.entries(a.branches!)) {
        const n = ATTACKS[to]!;
        expect(n, `${a.id} → ${dir} → ${to}`).toBeDefined();
        expect(n.authored, to).toBeDefined();
        expect(n.authored!.continueFrom?.attack, `${to} は ${a.id} から続く`).toBe(a.authored);
        expect(n.authored!.continueFrom?.t, `${to} の起点`).toBeCloseTo(a.cancelAt, 6);
      }
    }
  });

  it('普通の続き（next）を奪わない: next のある技の分岐は、前（forward）以外の向き（横・後ろ）だけ。next の無い技（コンボの終わり）は、前へ倒したときだけ延長する', () => {
    for (const a of sources) {
      const dirs = Object.keys(a.branches!);
      if (a.next) expect(dirs, a.id).not.toContain('forward');
      else expect(dirs, a.id).toEqual(['forward']);
    }
  });

  it('分岐先はコンボの連鎖（next）をたどって来ない（分岐は 1 段だけ。終端は分岐先で止まる）', () => {
    for (const a of sources) {
      for (const to of Object.values(a.branches!)) {
        expect(ATTACKS[to]!.next, to).toBeUndefined();
        expect(ATTACKS[to]!.branches, to).toBeUndefined();
      }
    }
  });

  it('分岐先は大剣のものは両手持ち（twoHanded）、片手剣のものは片手。片手剣の分岐先は盾版も焼かれる', () => {
    for (const a of sources) {
      for (const to of Object.values(a.branches!)) {
        const two = ATTACKS[to]!.authored!.twoHanded !== undefined;
        expect(two, to).toBe(a.authored!.twoHanded !== undefined);
      }
    }
  });
});

describe('溜めの段階で放つ技が変わる（ChargeDef.levelNext。ADR-023）', () => {
  it('大剣は最大の段階だけ地割り、途中で離せば溜め斬り。片手剣は変わらない', () => {
    const c = CHARGES.greatsword!;
    expect(c.levelNext).toBeDefined();
    expect(c.levelNext).toHaveLength(c.levels.length + 1);
    expect(c.levelNext!.slice(0, -1).every((v) => v === undefined)).toBe(true);
    expect(c.levelNext![c.levelNext!.length - 1]).toBe('gsSmash');
    expect(CHARGES.sword!.levelNext).toBeUndefined();
  });

  it('放ちうる技はどれも、溜めの構えの終端から続く手付けで、ダメージは溜め斬り以上（地割りは溜め斬りより重い）', () => {
    const c = CHARGES.greatsword!;
    for (const id of new Set([c.next, ...c.levelNext!.filter((v): v is string => v !== undefined)])) {
      const a = ATTACKS[id]!;
      expect(a.authored!.continueFrom?.attack, id).toBe(c.clip);
      expect(a.authored!.continueFrom?.t, id).toBeCloseTo(c.clip.duration, 9);
      expect(a.damage, id).toBeGreaterThanOrEqual(ATTACKS[c.next]!.damage);
    }
  });
});

describe('地面を叩く技（AttackDef.impact。ADR-023）', () => {
  const smashes = Object.values(ATTACKS).filter((a) => a.impact);

  it('地割り・叩き落としだけが地面を叩く', () => {
    expect(smashes.map((a) => a.id).sort()).toEqual(['gsDrop', 'gsSmash']);
  });

  it('床に当たる時刻は当たりの持続の中、位置は体の前 1〜3m、強さは 0.3〜1.5。剣筋は床に当たるまで続く', () => {
    for (const a of smashes) {
      const im = a.impact!;
      expect(im.t, a.id).toBeGreaterThan(a.activeStart);
      expect(im.t, a.id).toBeLessThan(a.activeEnd);
      expect(im.dist, a.id).toBeGreaterThanOrEqual(1);
      expect(im.dist, a.id).toBeLessThanOrEqual(3);
      expect(im.power, a.id).toBeGreaterThanOrEqual(0.3);
      expect(im.power, a.id).toBeLessThanOrEqual(1.5);
      expect(a.trail[1], a.id).toBeGreaterThan(im.t);
      // 床に当たる時刻は、フレームの上で 1 つに決まる（Player が f + 1 === round(t × 60) で 1 回だけ出す）
      expect(Math.round(im.t * 60), a.id).toBeGreaterThan(resolveAttack(a).startup);
    }
  });

  it('地割りは叩き落としより強く（威力・衝撃の強さ・範囲）、どちらも溜め斬り（gsHeavy）の威力以下', () => {
    expect(ATTACKS.gsSmash!.damage).toBeGreaterThan(ATTACKS.gsDrop!.damage);
    expect(ATTACKS.gsSmash!.impact!.power).toBeGreaterThan(ATTACKS.gsDrop!.impact!.power);
    const arc = (id: string) => {
      const h = ATTACKS[id]!.hitbox;
      if (h.kind !== 'arc') throw new Error(`${id} は扇ではない`);
      return h;
    };
    expect(arc('gsSmash').range).toBeGreaterThan(arc('gsDrop').range);
    expect(arc('gsSmash').halfAngle).toBeGreaterThan(arc('gsDrop').halfAngle);
    expect(ATTACKS.gsDrop!.damage).toBeLessThanOrEqual(ATTACKS.gsHeavy!.damage);
  });
});

describe('片手剣の分岐の技は、同じ位置づけの技より重い（ダメージ・ノックバック）', () => {
  it('跳び退き斬り上げ > 下がりながらの払い、打ち上げ > 3 段目の突き、回転斬り > 横薙ぎ以上の広さ（全方位）', () => {
    expect(ATTACKS.comboHop!.damage).toBeGreaterThan(ATTACKS.retreat!.damage);
    expect(ATTACKS.comboUpper!.damage).toBeGreaterThan(ATTACKS.combo3!.damage);
    expect(ATTACKS.comboUpper!.knockback).toBeGreaterThan(ATTACKS.combo3!.knockback);
    const h = ATTACKS.comboSpin!.hitbox;
    expect(h.kind === 'arc' && h.halfAngle >= Math.PI).toBe(true);
    expect(ATTACKS.comboSpin!.damage).toBeGreaterThan(ATTACKS.sweep!.damage);
  });
});
