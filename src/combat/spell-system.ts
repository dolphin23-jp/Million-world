import { wrapAngle } from '../core/math';
import type { Circle } from '../world/collision';
import { createRayHit, type World } from '../world/world';
import { CRIT } from './data/crit';
import { HIT_FEEDBACK } from './data/hit-feedback';
import { SPELL_TARGETING, type ConeSpell, type BeamSpell, type RegenSpell, type RingSpell, type SpellDef, type StrikeSpell } from './data/spells';
import { hitboxHits, makeHitEvent, type HitEvent, type HitOrigin, type Hurtbox } from './hit';
import type { DamageResult } from './health';

/**
 * 魔法（杖。ADR-048）の sim。three にも DOM にも依存しない純粋なクラスと関数。
 * 近接の攻撃（持続フレームのあいだ、攻撃者の前に出る領域）と違い、魔法の当たりは**世界に置かれる**: 落雷・爆発は地面の円（予告の輪 → 着弾）、
 * 吹雪・火炎放射は術者に付く扇・帯（一定の間隔で当たる）、旋風は術者の足元から広がる輪（輪ごとに 1 回）、再生は術者の体力を少しずつ回復する。
 * 魔弾（通常攻撃）は飛び道具（ProjectileSystem の team 'bolt'）で、ここには入らない。命中して爆ぜるとき（大魔弾）だけ addBurst を使う。
 *
 * 見た目（SpellFx）は、ここの効果の状態（strikes / cones / beams / rings / regen）を読むだけ。
 * 毎フレーム確保しないよう、効果の作成（詠唱 = まれ）以外では配列・オブジェクトを作らない（命中イベントは近接の攻撃と同じく命中ごとに作る）。
 */

/** 魔法の当たりの相手（Enemy・Breakable が満たす CombatTarget の部分）。invulnerable の相手（倒れている・死んでいる）には当たらない */
export interface SpellTarget {
  readonly body: Hurtbox;
  takeHit(ev: HitEvent): DamageResult;
}

/** ターゲットを選ぶ候補（生きている敵の位置） */
export interface SpellTargetCand {
  id: number;
  x: number;
  z: number;
}

/** 術者として読む部分（Player がそのまま満たす）。位置・向きは毎ステップ読む（吹雪・火炎放射は術者に付いて動く） */
export interface SpellCasterView {
  readonly body: Circle;
  readonly yaw: number;
  /** 魔法を放つ詠唱の最中（放ったあと、その攻撃を続けているあいだ）の合図の番号。そうでなければ 0。吹雪は、これが自分の番号と変わったら（回避・被弾・詠唱の終わり）止まる */
  readonly liveCastSerial: number;
  /** 持続魔法（火炎放射）を放出しているあいだの合図の番号。放出していなければ 0 */
  readonly channelingSerial: number;
  readonly damageMul?: number;
  readonly knockbackMul?: number;
  readonly critRate?: number;
  readonly critDamage?: number;
}

/** 魔法を放つときの術者の状態（Player.lastCast と位置・向き）。power = スキルのレベル・INT の威力の倍率 */
export interface CastParams {
  x: number;
  z: number;
  yaw: number;
  power: number;
  serial: number;
}

export type SpellHitKind = 'strike' | 'ring' | 'tick' | 'burst';

export interface SpellHitInfo {
  spell: SpellDef;
  kind: SpellHitKind;
}

/** 魔法の命中・着弾・回復の通知（演出・ダメージ数字・体力の反映。Game が受ける） */
export interface SpellHandlers<T extends SpellTarget> {
  onHit: (ev: HitEvent, target: T, result: DamageResult, info: SpellHitInfo) => void;
  /** 落雷・爆発・爆ぜる弾の 1 つが着弾した（index は点の番号。0 = 中心） */
  onLand?: (fx: StrikeFx, point: StrikePoint, index: number) => void;
  /** 旋風の輪が 1 つ広がり始めた */
  onRing?: (fx: RingFx, ring: number) => void;
  /** 再生の 1 刻みの回復量（hpPerSecond × 刻みの秒数 × 威力） */
  onHeal?: (amount: number, fx: RegenFx) => void;
}

/** 落雷・爆発の 1 つの点。位置は、ターゲットに付いて動く間は更新される（StrikeFx.anchorId）。landed になったらその位置で止まる */
export interface StrikePoint {
  x: number;
  z: number;
  /** ターゲットからの相対位置（ターゲットに付いて動く間の位置の求め方） */
  ox: number;
  oz: number;
  radius: number;
  damage: number;
  /** 着弾する時刻（効果の age がこれに達した step） */
  delay: number;
  landed: boolean;
}

export interface StrikeFx {
  readonly kind: 'strike';
  readonly spell: StrikeSpell;
  readonly serial: number;
  readonly power: number;
  /** ターゲットの id。位置が追う相手（null = 追わない） */
  readonly anchorId: number | null;
  /** 爆ぜる弾の直撃を受けた相手など、この効果が当てない相手（0 = なし。プレイヤーは 0、敵は 1 以上なので重ならない） */
  readonly excludeId: number | null;
  /** 位置が止まる時刻（age がこれを超えたら追わない） */
  readonly lockAt: number;
  readonly points: StrikePoint[];
  age: number;
  /** 全部の点が着弾して、見た目の余韻が終わる時刻 */
  readonly endAt: number;
}

export interface ConeFx {
  readonly kind: 'cone';
  readonly spell: ConeSpell;
  readonly serial: number;
  readonly power: number;
  age: number;
  /** 術者に付いて動く位置・向き（毎 step 術者から写す。見た目が読む） */
  x: number;
  z: number;
  yaw: number;
  /** 止まったか（時間切れ・術者が詠唱をやめた）。止まったら age を 0 に戻して余韻（BEAM_LINGER_FRAMES）を数える。見た目が消え始める目印 */
  ended: boolean;
}

export interface BeamFx {
  readonly kind: 'beam';
  readonly spell: BeamSpell;
  readonly serial: number;
  readonly power: number;
  age: number;
  /** 銃口（杖の先）の位置と向き（術者から毎 step 写す）と、いまの届く長さ（障害物に遮られたら短い） */
  x: number;
  z: number;
  yaw: number;
  len: number;
  ended: boolean;
}

export interface RingFx {
  readonly kind: 'ring';
  readonly spell: RingSpell;
  readonly serial: number;
  readonly power: number;
  /** 中心（詠唱した位置。放ったあとは術者が動いても動かない） */
  readonly x: number;
  readonly z: number;
  age: number;
  /** 輪ごとに、すでに当てた相手の id（輪が通り過ぎるとき 1 回ずつ） */
  readonly hit: Set<number>[];
}

export interface RegenFx {
  readonly kind: 'regen';
  readonly spell: RegenSpell;
  readonly power: number;
  age: number;
}

/** 着弾したあと、見た目が残る長さ（フレーム）。効果の配列から外れるのはその後 */
export const STRIKE_LINGER_FRAMES = 36;
/** 止まったあと（吹雪・火炎放射）、見た目が消えていく長さ */
export const BEAM_LINGER_FRAMES = 18;
/** 旋風の輪が通り過ぎたあと、見た目が残る長さ */
export const RING_LINGER_FRAMES = 20;
/** 火炎放射が障害物に遮られるかを調べる高さ（m。杖の先の高さ） */
const BEAM_HEIGHT = 1.0;

const _origin: HitOrigin = { x: 0, z: 0, yaw: 0 };
const _ray = createRayHit();

/**
 * ターゲットを選ぶ: ロックしている敵（cands にいれば距離に関わらず）→ いなければ、正面の扇（±frontConeDeg）の maxRange 以内でいちばん近い敵 → いなければ null。
 * 候補は生きている敵だけを渡す
 */
export function pickSpellTarget(cands: readonly SpellTargetCand[], x: number, z: number, yaw: number, lockedId: number | null): SpellTargetCand | null {
  if (lockedId !== null) {
    for (const c of cands) if (c.id === lockedId) return c;
  }
  const half = (SPELL_TARGETING.frontConeDeg * Math.PI) / 180;
  let best: SpellTargetCand | null = null;
  let bestD = Infinity;
  for (const c of cands) {
    const dx = c.x - x;
    const dz = c.z - z;
    const d = Math.hypot(dx, dz);
    if (d > SPELL_TARGETING.maxRange) continue;
    if (d > 0.3 && Math.abs(wrapAngle(Math.atan2(dx, dz) - yaw)) > half) continue;
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

export class SpellSystem {
  readonly strikes: StrikeFx[] = [];
  readonly cones: ConeFx[] = [];
  readonly beams: BeamFx[] = [];
  readonly rings: RingFx[] = [];
  regen: RegenFx | null = null;

  constructor(
    /** 火炎放射が障害物で止まるかを調べる世界（なければ遮られない） */
    private readonly world: Pick<World, 'raycast'> | null = null,
    /** 命中イベントの attackerId（プレイヤー = 0） */
    private readonly attackerId = 0,
    /** 会心の抽選（0 以上 1 未満。rng() < 会心率 なら会心） */
    private rng: () => number = () => 1,
  ) {}

  setRng(rng: () => number): void {
    this.rng = rng;
  }

  /** 何か効果が残っているか */
  get active(): boolean {
    return this.strikes.length + this.cones.length + this.beams.length + this.rings.length > 0 || this.regen !== null;
  }

  /** すべて消す（戦闘のやり直し） */
  clear(): void {
    this.strikes.length = 0;
    this.cones.length = 0;
    this.beams.length = 0;
    this.rings.length = 0;
    this.regen = null;
  }

  /**
   * 魔法を放つ（魔弾 = bolt は飛び道具なのでここでは何もしない）。target = 選んだターゲット（落雷・爆発の中心。なければ前方の点）。
   * 戻り値は作った効果（見た目・音が起点に使う。bolt は null）
   */
  cast(spell: SpellDef, c: CastParams, target: SpellTargetCand | null): StrikeFx | ConeFx | BeamFx | RingFx | RegenFx | null {
    switch (spell.kind) {
      case 'strike':
        return this.addStrike(spell, c, target);
      case 'cone': {
        // 同じ詠唱の吹雪は 1 つだけ（放ち直しは新しい番号で別の効果になる）
        const fx: ConeFx = { kind: 'cone', spell, serial: c.serial, power: c.power, age: 0, x: c.x, z: c.z, yaw: c.yaw, ended: false };
        this.cones.push(fx);
        return fx;
      }
      case 'beam': {
        const fx: BeamFx = { kind: 'beam', spell, serial: c.serial, power: c.power, age: 0, x: c.x, z: c.z, yaw: c.yaw, len: spell.length, ended: false };
        this.beams.push(fx);
        return fx;
      }
      case 'ring': {
        const hit: Set<number>[] = [];
        for (let i = 0; i < spell.radii.length; i++) hit.push(new Set<number>());
        const fx: RingFx = { kind: 'ring', spell, serial: c.serial, power: c.power, x: c.x, z: c.z, age: 0, hit };
        this.rings.push(fx);
        return fx;
      }
      case 'regen':
        // 重ねがけは、残りを数え直す（長さは足さない）
        this.regen = { kind: 'regen', spell, power: c.power, age: 0 };
        return this.regen;
      case 'bolt':
        return null;
    }
  }

  /**
   * 魔弾の命中で爆ぜる（大魔弾。BoltSpell.burst）: (x, z) を中心に、すぐ（予告なし）に範囲のダメージ。直撃した相手（excludeId）には当てない。
   * damage は撃つ時点の倍率まで掛かった値ではなく魔法の定義の値（威力・STR の倍率はここで掛かる）
   */
  addBurst(spell: StrikeSpell, x: number, z: number, power: number, serial: number, excludeId: number | null): StrikeFx {
    const fx: StrikeFx = {
      kind: 'strike',
      spell,
      serial,
      power,
      anchorId: null,
      excludeId,
      lockAt: 0,
      points: [{ x, z, ox: 0, oz: 0, radius: spell.center.radius, damage: spell.center.damage, delay: 0, landed: false }],
      age: 0,
      endAt: STRIKE_LINGER_FRAMES,
    };
    this.strikes.push(fx);
    return fx;
  }

  private addStrike(spell: StrikeSpell, c: CastParams, target: SpellTargetCand | null): StrikeFx {
    let tx: number;
    let tz: number;
    let base: number;
    if (target) {
      tx = target.x;
      tz = target.z;
      base = Math.atan2(tx - c.x, tz - c.z);
    } else {
      tx = c.x + Math.sin(c.yaw) * spell.fallbackDistance;
      tz = c.z + Math.cos(c.yaw) * spell.fallbackDistance;
      base = c.yaw;
    }
    const points: StrikePoint[] = [{ x: tx, z: tz, ox: 0, oz: 0, radius: spell.center.radius, damage: spell.center.damage, delay: spell.warnFrames, landed: false }];
    const ar = spell.around;
    if (ar) {
      for (let i = 0; i < ar.count; i++) {
        // ターゲットから見て等間隔の向き（最初は、術者へ向かう向きの少し横）。近い・遠いを交互に
        const a = base + ((i + 0.5) * Math.PI * 2) / ar.count;
        const dist = ar.ringMin + (ar.ringMax - ar.ringMin) * (i % 2);
        const ox = Math.sin(a) * dist;
        const oz = Math.cos(a) * dist;
        points.push({ x: tx + ox, z: tz + oz, ox, oz, radius: ar.radius, damage: ar.damage, delay: spell.warnFrames + (i + 1) * spell.staggerFrames, landed: false });
      }
    }
    const last = points[points.length - 1]!.delay;
    const fx: StrikeFx = {
      kind: 'strike',
      spell,
      serial: c.serial,
      power: c.power,
      anchorId: target ? target.id : null,
      excludeId: null,
      lockAt: Math.max(0, spell.warnFrames - spell.lockFrames),
      points,
      age: 0,
      endAt: last + STRIKE_LINGER_FRAMES,
    };
    this.strikes.push(fx);
    return fx;
  }

  /**
   * 1 sim ステップ進める（プレイヤーの攻撃を解決する位置で呼ぶ）。targets = 当たりの相手（敵・壊せる物）。
   * 時間は止まっていても進む（ヒットストップ中は呼ばれない = Game の step と同じ）
   */
  step<T extends SpellTarget>(caster: SpellCasterView, targets: readonly T[], handlers: SpellHandlers<T>): void {
    this.stepStrikes(targets, caster, handlers);
    this.stepCones(caster, targets, handlers);
    this.stepBeams(caster, targets, handlers);
    this.stepRings(targets, caster, handlers);
    this.stepRegen(handlers);
  }

  // ---------------------------------------------------------------- 落雷・爆発

  private stepStrikes<T extends SpellTarget>(targets: readonly T[], caster: SpellCasterView, h: SpellHandlers<T>): void {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const fx = this.strikes[i]!;
      // 予告の輪はターゲットに付いて動き、着弾の少し前に止まる
      if (fx.anchorId !== null && fx.age <= fx.lockAt) {
        for (const t of targets) {
          if (t.body.id !== fx.anchorId) continue;
          for (const p of fx.points) {
            p.x = t.body.x + p.ox;
            p.z = t.body.z + p.oz;
          }
          break;
        }
      }
      for (let k = 0; k < fx.points.length; k++) {
        const p = fx.points[k]!;
        if (p.landed || fx.age < p.delay) continue;
        p.landed = true;
        h.onLand?.(fx, p, k);
        this.landStrike(fx, p, targets, caster, h);
      }
      fx.age++;
      if (fx.age >= fx.endAt) this.strikes.splice(i, 1);
    }
  }

  private landStrike<T extends SpellTarget>(fx: StrikeFx, p: StrikePoint, targets: readonly T[], caster: SpellCasterView, h: SpellHandlers<T>): void {
    const sp = fx.spell;
    _origin.x = p.x;
    _origin.z = p.z;
    _origin.yaw = 0;
    // 予告なし（warnFrames 0）= 魔弾の命中で爆ぜる範囲
    const kind: SpellHitKind = sp.warnFrames === 0 ? 'burst' : 'strike';
    for (const t of targets) {
      const b = t.body;
      if (b.invulnerable || b.id === fx.excludeId) continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d - b.r > p.radius) continue;
      // 中心から縁へ向けて、edgeFalloff まで落ちる（中心 1 → 縁 edgeFalloff）
      const k = Math.min(1, Math.max(0, d / p.radius));
      const scale = 1 - (1 - sp.edgeFalloff) * k;
      const ev = this.eventOf(_origin, b, p.damage * scale, sp.knockback, sp.hitStop, fx.power, caster, false);
      h.onHit(ev, t, t.takeHit(ev), { spell: sp, kind });
    }
  }

  // ---------------------------------------------------------------- 吹雪

  private stepCones<T extends SpellTarget>(caster: SpellCasterView, targets: readonly T[], h: SpellHandlers<T>): void {
    for (let i = this.cones.length - 1; i >= 0; i--) {
      const fx = this.cones[i]!;
      const sp = fx.spell;
      if (!fx.ended) {
        // 術者が詠唱をやめた（回避・被弾・詠唱の終わり）か、時間切れなら止まる。そうでなければ術者に付いて動く
        if (caster.liveCastSerial !== fx.serial || fx.age >= sp.frames) {
          fx.ended = true;
          fx.age = 0; // 止まった時刻から余韻を数える
        } else {
          fx.x = caster.body.x;
          fx.z = caster.body.z;
          fx.yaw = caster.yaw;
          if (fx.age % sp.tickFrames === 0) this.tickCone(fx, targets, caster, h);
        }
      }
      fx.age++;
      if (fx.ended && fx.age > BEAM_LINGER_FRAMES) this.cones.splice(i, 1);
    }
  }

  private tickCone<T extends SpellTarget>(fx: ConeFx, targets: readonly T[], caster: SpellCasterView, h: SpellHandlers<T>): void {
    const sp = fx.spell;
    _origin.x = fx.x;
    _origin.z = fx.z;
    _origin.yaw = fx.yaw;
    const box = { kind: 'arc', range: sp.range, halfAngle: (sp.halfAngleDeg * Math.PI) / 180 } as const;
    for (const t of targets) {
      if (t.body.invulnerable || !hitboxHits(_origin, box, t.body)) continue;
      const ev = this.eventOf(_origin, t.body, sp.damage, sp.knockback, sp.hitStop, fx.power, caster, true);
      h.onHit(ev, t, t.takeHit(ev), { spell: sp, kind: 'tick' });
    }
  }

  // ---------------------------------------------------------------- 火炎放射

  private stepBeams<T extends SpellTarget>(caster: SpellCasterView, targets: readonly T[], h: SpellHandlers<T>): void {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const fx = this.beams[i]!;
      const sp = fx.spell;
      if (!fx.ended) {
        if (caster.channelingSerial !== fx.serial || fx.age >= sp.frames) {
          fx.ended = true;
        } else {
          const dx = Math.sin(caster.yaw);
          const dz = Math.cos(caster.yaw);
          fx.x = caster.body.x + dx * SPELL_TARGETING.muzzle;
          fx.z = caster.body.z + dz * SPELL_TARGETING.muzzle;
          fx.yaw = caster.yaw;
          // 障害物（柱・壁・高い箱）に当たったら、そこまで
          fx.len = sp.length;
          if (this.world && this.world.raycast(fx.x, fx.z, fx.x + dx * sp.length, fx.z + dz * sp.length, BEAM_HEIGHT, _ray)) {
            fx.len = Math.max(0.2, Math.hypot(_ray.x - fx.x, _ray.z - fx.z));
          }
          if (fx.age % sp.tickFrames === 0) this.tickBeam(fx, targets, caster, h);
        }
        if (fx.ended) fx.age = 0; // 止まった時刻から余韻を数える
      }
      fx.age++;
      if (fx.ended && fx.age > BEAM_LINGER_FRAMES) this.beams.splice(i, 1);
    }
  }

  private tickBeam<T extends SpellTarget>(fx: BeamFx, targets: readonly T[], caster: SpellCasterView, h: SpellHandlers<T>): void {
    const sp = fx.spell;
    _origin.x = fx.x;
    _origin.z = fx.z;
    _origin.yaw = fx.yaw;
    const box = { kind: 'line', length: fx.len, radius: sp.width / 2 } as const;
    for (const t of targets) {
      if (t.body.invulnerable || !hitboxHits(_origin, box, t.body)) continue;
      const ev = this.eventOf(_origin, t.body, sp.damage, sp.knockback, sp.hitStop, fx.power, caster, true);
      h.onHit(ev, t, t.takeHit(ev), { spell: sp, kind: 'tick' });
    }
  }

  // ---------------------------------------------------------------- 旋風

  /** 輪 i の、時刻 age の外半径（0 〜 radii[i]。外へ向けて減速しながら広がる） */
  static ringOuter(sp: RingSpell, ring: number, age: number): number {
    const t = Math.min(1, Math.max(0, (age - ring * sp.staggerFrames) / sp.expandFrames));
    return sp.radii[ring]! * (1 - (1 - t) * (1 - t));
  }

  private stepRings<T extends SpellTarget>(targets: readonly T[], caster: SpellCasterView, h: SpellHandlers<T>): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const fx = this.rings[i]!;
      const sp = fx.spell;
      for (let r = 0; r < sp.radii.length; r++) {
        if (fx.age === r * sp.staggerFrames) h.onRing?.(fx, r);
        if (fx.age < r * sp.staggerFrames || fx.age > r * sp.staggerFrames + sp.expandFrames) continue;
        const outer = SpellSystem.ringOuter(sp, r, fx.age);
        const inner = Math.max(0, outer - sp.thickness);
        _origin.x = fx.x;
        _origin.z = fx.z;
        _origin.yaw = 0;
        const seen = fx.hit[r]!;
        for (const t of targets) {
          const b = t.body;
          if (b.invulnerable || seen.has(b.id)) continue;
          const d = Math.hypot(b.x - fx.x, b.z - fx.z);
          // 輪（内側 inner〜外側 outer の帯）が、相手の円に重なったら当たる
          if (d - b.r > outer || d + b.r < inner) continue;
          seen.add(b.id);
          const ev = this.eventOf(_origin, b, sp.damage, sp.knockback, sp.hitStop, fx.power, caster, false);
          h.onHit(ev, t, t.takeHit(ev), { spell: sp, kind: 'ring' });
        }
      }
      fx.age++;
      const last = (sp.radii.length - 1) * sp.staggerFrames + sp.expandFrames;
      if (fx.age > last + RING_LINGER_FRAMES) this.rings.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- 再生

  private stepRegen<T extends SpellTarget>(h: SpellHandlers<T>): void {
    const fx = this.regen;
    if (!fx) return;
    const sp = fx.spell;
    fx.age++;
    if (fx.age % sp.tickFrames === 0) h.onHeal?.(sp.hpPerSecond * (sp.tickFrames / 60) * fx.power, fx);
    if (fx.age >= sp.frames) this.regen = null;
  }

  // ---------------------------------------------------------------- 命中イベント

  /**
   * 命中イベントを作る: 基準の値 × 威力（スキルのレベル・INT）× STR × 会心。ノックバックは威力の半分だけ倍率を掛ける（近接の攻撃と同じ約束）、ヒットストップは威力に比例。
   * chip = 継続の刻み（吹雪・火炎放射）。会心はふつうに抽選する
   */
  private eventOf(origin: HitOrigin, target: Circle & { id: number }, damage: number, knockback: number, hitStop: number, power: number, c: SpellCasterView, chip: boolean): HitEvent {
    const rate = c.critRate ?? 0;
    const crit = rate > 0 && this.rng() < rate;
    return makeHitEvent(this.attackerId, origin, target, {
      damage: Math.max(1, Math.round(damage * power * (c.damageMul ?? 1) * (crit ? c.critDamage ?? CRIT.baseDamage : 1))),
      knockback: knockback * (1 + (power - 1) * 0.5) * (c.knockbackMul ?? 1) * (crit ? CRIT.knockbackScale : 1),
      hitStop: Math.min(Math.round(hitStop * power) + (crit && hitStop > 0 ? CRIT.hitStopBonus : 0), HIT_FEEDBACK.maxHitStop),
      crit,
      chip,
    });
  }
}
