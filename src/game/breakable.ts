import type { CombatTarget } from './combat';
import type { DamageResult } from '../combat/health';
import type { HitEvent, Hurtbox } from '../combat/hit';
import type { BreakableDef, Obstacle, World } from '../world/world';

/**
 * 壊せる障害物（M7-4d。ADR-046）の実行時の状態。プレイヤーの攻撃の相手（CombatTarget）として、敵と同じ道（resolvePlayerAttack）で当てる。
 * 体力は障害物の印（Obstacle.breakable.hp）から。壊れたら Game が World から外す（World.setActive）。
 * 当たりの円は、円柱ならその円、箱ならその外接に近い円（長い辺の半分）。ヒットボックスは円に当たるので、箱の角に少し甘い
 */
export class Breakable implements CombatTarget {
  readonly body: Hurtbox;
  /** 足の高さ 0（地面から立ち上がる）と、背の高さ = 上面。プレイヤーの近接が縦に届くかの判定に使う（M7-4b） */
  readonly y = 0;
  readonly height: number;
  readonly max: number;
  hp: number;
  broken = false;
  /** 当たるたびに増える（見た目が揺れるきっかけ） */
  hitSerial = 0;
  readonly def: BreakableDef;

  constructor(
    /** World.obstacles の添字 */
    readonly index: number,
    o: Obstacle & { breakable: BreakableDef },
  ) {
    this.def = o.breakable;
    this.max = o.breakable.hp;
    this.hp = this.max;
    this.height = o.top;
    // 敵（id 1〜）・プレイヤー（0）と重ならない負の id（HitTracker のキー）
    this.body = { id: -(index + 1), x: o.x, z: o.z, r: o.kind === 'circle' ? o.r : Math.max(o.hx, o.hz), invulnerable: false };
  }

  takeHit(ev: HitEvent): DamageResult {
    if (this.broken) return { dealt: 0, killed: false };
    const dealt = Math.min(this.hp, Math.max(0, ev.damage));
    this.hp -= dealt;
    this.hitSerial++;
    if (this.hp <= 0) this.markBroken();
    return { dealt, killed: this.broken };
  }

  /** 壊れた状態にする（体力を使い切った・猪に突き破られた）。当たりは無効になる */
  markBroken(): void {
    this.hp = 0;
    this.broken = true;
    this.body.invulnerable = true;
  }

  /** 元に戻す（戦闘のやり直し） */
  reset(): void {
    this.hp = this.max;
    this.broken = false;
    this.body.invulnerable = false;
  }
}

/** 世界の壊せる障害物すべてから Breakable を作る（World.obstacles の順） */
export function createBreakables(world: World): Breakable[] {
  const out: Breakable[] = [];
  world.obstacles.forEach((o, i) => {
    if (o.breakable) out.push(new Breakable(i, o as Obstacle & { breakable: BreakableDef }));
  });
  return out;
}
