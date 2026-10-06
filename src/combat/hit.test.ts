import { describe, expect, it } from 'vitest';
import { HitTracker, collectHits, hitboxHits, isActiveFrame, makeHitEvent, type HitOrigin, type HitboxDef, type Hurtbox } from './hit';
import { applyDamage, createHealth, isDead } from './health';
import { Knockback } from './knockback';
import { ATTACKS, resolveAttack } from './data/attacks';

const deg = (d: number) => (d * Math.PI) / 180;
/** 原点で +Z（yaw 0）を向く攻撃者 */
const O: HitOrigin = { x: 0, z: 0, yaw: 0 };
const ARC: HitboxDef = { kind: 'arc', range: 2, halfAngle: deg(60) };
const LINE: HitboxDef = { kind: 'line', length: 2, radius: 0.3 };
const at = (x: number, z: number, r = 0.5) => ({ x, z, r });
const hurt = (id: number, x: number, z: number, over: Partial<Hurtbox> = {}): Hurtbox => ({ id, x, z, r: 0.5, invulnerable: false, ...over });

describe('hitboxHits: 扇形', () => {
  it('正面で届く距離（縁まで）なら当たる。中心までの距離ではなく縁で測る', () => {
    expect(hitboxHits(O, ARC, at(0, 2.4))).toBe(true); // 縁まで 1.9
    expect(hitboxHits(O, ARC, at(0, 2.5))).toBe(true); // 縁まで 2.0（境界は当たる）
    expect(hitboxHits(O, ARC, at(0, 2.6))).toBe(false);
  });

  it('角度の外は当たらない。相手の円の大きさぶんだけ角度は広がる', () => {
    // 距離 1.5・角度 70°（半角 60° の外）。円が小さければ外れ、大きければ縁が扇に掛かって当たる
    const x = Math.sin(deg(70)) * 1.5;
    const z = Math.cos(deg(70)) * 1.5;
    expect(hitboxHits(O, ARC, at(x, z, 0.1))).toBe(false);
    expect(hitboxHits(O, ARC, at(x, z, 0.5))).toBe(true);
  });

  it('背後は当たらない', () => {
    expect(hitboxHits(O, ARC, at(0, -1))).toBe(false);
  });

  it('攻撃者の向き（yaw）に追従する。+X を向けば +X の相手に当たる', () => {
    const east: HitOrigin = { x: 0, z: 0, yaw: Math.PI / 2 };
    expect(hitboxHits(east, ARC, at(1.5, 0))).toBe(true);
    expect(hitboxHits(east, ARC, at(0, 1.5))).toBe(false);
  });

  it('角度は ±π の継ぎ目をまたいでも正しい（yaw = π、相手は −Z 側）', () => {
    const back: HitOrigin = { x: 0, z: 0, yaw: Math.PI };
    expect(hitboxHits(back, ARC, at(0.2, -1.5))).toBe(true);
    expect(hitboxHits(back, ARC, at(0.2, 1.5))).toBe(false);
  });

  it('攻撃者の中心が相手の円の中にあれば向きに関係なく当たる', () => {
    expect(hitboxHits(O, ARC, at(0, -0.3))).toBe(true);
  });

  it('攻撃者が動けば領域も動く（攻撃の前進中に相手へ届く）', () => {
    const target = at(0, 3.0);
    expect(hitboxHits(O, ARC, target)).toBe(false);
    expect(hitboxHits({ x: 0, z: 0.6, yaw: 0 }, ARC, target)).toBe(true);
  });
});

describe('hitboxHits: 線分（突き）', () => {
  it('正面の線の上は、長さ + 幅 + 相手の半径まで届く', () => {
    expect(hitboxHits(O, LINE, at(0, 2.7))).toBe(true); // 2 + 0.3 + 0.5 = 2.8 まで
    expect(hitboxHits(O, LINE, at(0, 2.9))).toBe(false);
  });

  it('線から横に離れると、幅 + 相手の半径で外れる（扇形と違い、斜めには広がらない）', () => {
    expect(hitboxHits(O, LINE, at(0.7, 1.0))).toBe(true); // 横 0.7 ≤ 0.3 + 0.5
    expect(hitboxHits(O, LINE, at(0.9, 1.0))).toBe(false);
  });

  it('背後は当たらない（線は攻撃者の位置から前へだけ伸びる）', () => {
    expect(hitboxHits(O, LINE, at(0, -1.2))).toBe(false);
  });
});

describe('collectHits / HitTracker', () => {
  it('1 攻撃 1 対象 1 回: 持続中に何度評価しても同じ対象は 1 度しか返さない', () => {
    const tracker = new HitTracker();
    const targets = [hurt(1, 0, 1.5)];
    const out: Hurtbox[] = [];
    expect(collectHits(O, ARC, targets, tracker, out)).toBe(1);
    expect(collectHits(O, ARC, targets, tracker, out)).toBe(0);
    expect(collectHits(O, ARC, targets, tracker, out)).toBe(0);
    expect(out.map((t) => t.id)).toEqual([1]);
  });

  it('範囲内の複数の対象に 1 度ずつ当たる。範囲外には当たらない', () => {
    const tracker = new HitTracker();
    const targets = [hurt(1, 0, 1.5), hurt(2, 0.5, 1.2), hurt(3, 0, 8)];
    const out: Hurtbox[] = [];
    expect(collectHits(O, ARC, targets, tracker, out)).toBe(2);
    expect(out.map((t) => t.id)).toEqual([1, 2]);
  });

  it('次の攻撃（tracker を reset）では同じ対象にまた当たる', () => {
    const tracker = new HitTracker();
    const targets = [hurt(1, 0, 1.5)];
    const out: Hurtbox[] = [];
    collectHits(O, ARC, targets, tracker, out);
    tracker.reset();
    expect(collectHits(O, ARC, targets, tracker, out)).toBe(1);
  });

  it('無敵の対象には当たらず、記録もしない。無敵が切れれば同じ攻撃の持続中に当たる', () => {
    const tracker = new HitTracker();
    const t = hurt(1, 0, 1.5, { invulnerable: true });
    const out: Hurtbox[] = [];
    expect(collectHits(O, ARC, [t], tracker, out)).toBe(0);
    expect(tracker.has(1)).toBe(false);
    t.invulnerable = false;
    expect(collectHits(O, ARC, [t], tracker, out)).toBe(1);
  });

  it('途中で範囲に入った対象にも、持続の残りで当たる', () => {
    const tracker = new HitTracker();
    const t = hurt(1, 0, 4);
    const out: Hurtbox[] = [];
    expect(collectHits(O, ARC, [t], tracker, out)).toBe(0);
    t.z = 2;
    expect(collectHits(O, ARC, [t], tracker, out)).toBe(1);
  });
});

describe('isActiveFrame', () => {
  it('startup 以上 startup + active 未満が持続', () => {
    expect(isActiveFrame(12, 5, 11)).toBe(false);
    expect(isActiveFrame(12, 5, 12)).toBe(true);
    expect(isActiveFrame(12, 5, 16)).toBe(true);
    expect(isActiveFrame(12, 5, 17)).toBe(false);
  });
});

describe('makeHitEvent', () => {
  it('攻撃者から相手への単位ベクトルと、相手の円の手前の縁を命中位置にする', () => {
    const e = makeHitEvent(7, O, { id: 2, x: 0, z: 2, r: 0.5 }, { damage: 10, knockback: 0.3, hitStop: 4 });
    expect(e).toMatchObject({ attackerId: 7, targetId: 2, damage: 10, knockback: 0.3, hitStop: 4, dirX: 0, dirZ: 1 });
    expect(e.x).toBeCloseTo(0);
    expect(e.z).toBeCloseTo(1.5);
  });

  it('完全に重なっているときは攻撃者の向きを使う', () => {
    const e = makeHitEvent(1, { x: 1, z: 1, yaw: Math.PI / 2 }, { id: 2, x: 1, z: 1, r: 0.5 }, { damage: 1, knockback: 0, hitStop: 0 });
    expect(e.dirX).toBeCloseTo(1);
    expect(e.dirZ).toBeCloseTo(0);
  });
});

describe('Health', () => {
  it('残り HP を超えて減らさず、HP が 0 になった攻撃でだけ killed になる', () => {
    const h = createHealth(30);
    expect(applyDamage(h, 10)).toEqual({ dealt: 10, killed: false });
    expect(h.hp).toBe(20);
    expect(applyDamage(h, 50)).toEqual({ dealt: 20, killed: true });
    expect(isDead(h)).toBe(true);
    expect(applyDamage(h, 5)).toEqual({ dealt: 0, killed: false });
  });
});

describe('Knockback', () => {
  it('指定した距離ちょうど進んで止まる', () => {
    for (const frames of [1, 6, 12, 20]) {
      const k = new Knockback();
      k.start(0.6, 0.8, 1.5, frames);
      let x = 0;
      let z = 0;
      let steps = 0;
      while (k.active) {
        x += k.velX / 60;
        z += k.velZ / 60;
        k.step();
        steps++;
      }
      expect(steps).toBe(frames);
      expect(Math.hypot(x, z)).toBeCloseTo(1.5, 6);
      expect(x / Math.hypot(x, z)).toBeCloseTo(0.6, 6);
      expect(k.velX).toBe(0);
    }
  });

  it('距離 0 なら動かない', () => {
    const k = new Knockback();
    k.start(1, 0, 0, 12);
    expect(k.active).toBe(false);
  });

  it('速度は単調に落ちる（最初が最速）', () => {
    const k = new Knockback();
    k.start(1, 0, 1, 12);
    let prev = Infinity;
    while (k.active) {
      expect(k.velX).toBeLessThanOrEqual(prev);
      prev = k.velX;
      k.step();
    }
  });
});

describe('攻撃データのヒットボックス（実データ）', () => {
  // 想定の交戦距離: プレイヤー（半径 0.38）が敵（半径 0.5）の中心から 1.2〜1.8m の位置で正面から斬る
  const target = (d: number) => at(0, d, 0.5);

  it('すべての攻撃が、持続フレームの終わりまでに前進した位置から、正面 1.8m の敵に当たる', () => {
    for (const a of Object.values(ATTACKS)) {
      expect(hitboxHits(O, a.hitbox, target(1.8)), a.id).toBe(true);
    }
  });

  /** 全方位（扇の半角が 180° 以上）の技。体ごと 1 回転する技（大剣の大回転・連携回転斬り、片手剣の回転斬り） */
  const omni = (a: (typeof ATTACKS)[string]) => a.hitbox.kind === 'arc' && a.hitbox.halfAngle >= Math.PI;

  it('すべての攻撃が、真後ろの敵には当たらず（全方位の回転の技だけは当たる）、遠すぎる敵にも当たらない', () => {
    for (const a of Object.values(ATTACKS)) {
      expect(hitboxHits(O, a.hitbox, at(0, -1.5)), a.id).toBe(omni(a));
      expect(hitboxHits(O, a.hitbox, target(4)), a.id).toBe(false);
    }
  });

  it('全方位の技は回転の技（片手剣の回転斬り・逆回転斬り・大剣の大回転・連携回転斬り・逆の大回転）だけ。真後ろでも真横でも当たる', () => {
    const spins = ['comboSpin', 'gsSpin', 'gsSpin2', 'gsSpin3', 'spinRev'];
    expect(Object.values(ATTACKS).filter(omni).map((a) => a.id).sort()).toEqual([...spins].sort());
    for (const id of spins) {
      const h = ATTACKS[id]!.hitbox;
      for (const [x, z] of [[1.4, 0], [-1.4, 0], [0, -1.4], [0, 1.4]] as const) expect(hitboxHits(O, h, at(x, z, 0.5)), `${id} ${x},${z}`).toBe(true);
    }
  });

  it('斬り（扇形）は真横の少し前の敵にも当たり、突き（線）は当たらない', () => {
    const side = at(Math.sin(deg(55)) * 1.4, Math.cos(deg(55)) * 1.4, 0.5);
    expect(hitboxHits(O, ATTACKS.combo1!.hitbox, side)).toBe(true);
    expect(hitboxHits(O, ATTACKS.combo3!.hitbox, side)).toBe(false);
  });

  it('持続フレームが 1 つ以上あり、ヒットストップとノックバックは 0 以上', () => {
    for (const a of Object.values(ATTACKS)) {
      expect(resolveAttack(a).active, a.id).toBeGreaterThanOrEqual(1);
      expect(a.hitStop, a.id).toBeGreaterThanOrEqual(0);
      expect(a.knockback, a.id).toBeGreaterThanOrEqual(0);
      expect(a.damage, a.id).toBeGreaterThan(0);
    }
  });
});
