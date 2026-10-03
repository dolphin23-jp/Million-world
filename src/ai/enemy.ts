import { applyDamage, createHealth, type DamageResult, type Health } from '../combat/health';
import type { HitEvent, Hurtbox } from '../combat/hit';
import { Knockback } from '../combat/knockback';
import { rotateTowards } from '../core/math';
import type { EnemyDef } from './data/enemies';

/**
 * 敵の sim 側（three に依存しない。見た目は src/game/enemy-visual.ts）。
 * 状態: idle（待機。プレイヤーの方を向く）→ hit（ひるみ）→ idle / dead（死亡演出のあと removable）。
 * 追跡・予備動作・攻撃・硬直の FSM は、この状態を増やして作る。
 */

export type EnemyState = 'idle' | 'hit' | 'dead';

export class Enemy {
  /** 当たり判定。被弾側のハートボックスを兼ねる（Hurtbox は円 + id + 無敵） */
  readonly body: Hurtbox;
  yaw = 0;
  readonly health: Health;
  state: EnemyState = 'idle';
  stateFrame = 0;
  readonly knockback = new Knockback();
  /** 被弾のたびに増える（見た目側が被弾を検出するため）と、直近の被弾 */
  hitSerial = 0;
  lastHit: HitEvent | null = null;
  /** 死亡の演出が終わって取り除いてよい */
  removable = false;

  // 補間用の前ステップ
  prevX: number;
  prevZ: number;
  prevYaw = 0;

  constructor(
    readonly def: EnemyDef,
    id: number,
    x: number,
    z: number,
  ) {
    this.body = { id, x, z, r: def.radius, invulnerable: false };
    this.health = createHealth(def.hp);
    this.prevX = x;
    this.prevZ = z;
  }

  get id(): number {
    return this.body.id;
  }

  get dead(): boolean {
    return this.state === 'dead';
  }

  /** 位置と向きを設定する（スポーン直後に補間が前の位置から滑らないよう、前ステップも揃える） */
  place(x: number, z: number, yaw: number): void {
    this.body.x = this.prevX = x;
    this.body.z = this.prevZ = z;
    this.yaw = this.prevYaw = yaw;
  }

  /** 被弾。ダメージを適用し、ひるみ（または死亡）に入ってノックバックを始める */
  takeHit(ev: HitEvent): DamageResult {
    const r = applyDamage(this.health, ev.damage);
    if (this.dead) return r;
    this.hitSerial++;
    this.lastHit = ev;
    this.knockback.start(ev.dirX, ev.dirZ, ev.knockback * this.def.knockbackScale, this.def.knockbackFrames);
    if (r.killed) {
      this.body.invulnerable = true;
      this.setState('dead');
    } else {
      this.setState('hit', true);
    }
    return r;
  }

  step(dt: number, targetX: number, targetZ: number): void {
    this.prevX = this.body.x;
    this.prevZ = this.body.z;
    this.prevYaw = this.yaw;

    switch (this.state) {
      case 'idle': {
        const want = Math.atan2(targetX - this.body.x, targetZ - this.body.z);
        this.yaw = rotateTowards(this.yaw, want, this.def.turnSpeed * dt);
        break;
      }
      case 'hit':
        if (this.stateFrame >= this.def.hitStunFrames) this.setState('idle');
        break;
      case 'dead':
        if (this.stateFrame >= this.def.deathFrames) this.removable = true;
        break;
    }

    this.body.x += this.knockback.velX * dt;
    this.body.z += this.knockback.velZ * dt;
    this.knockback.step();
    this.stateFrame++;
  }

  private setState(s: EnemyState, forceRestart = false): void {
    if (this.state === s && !forceRestart) return;
    this.state = s;
    this.stateFrame = 0;
  }
}
