import { applyDamage, createHealth, type DamageResult, type Health } from '../combat/health';
import { HitTracker, isActiveFrame, type HitEvent, type Hurtbox } from '../combat/hit';
import { Knockback } from '../combat/knockback';
import { rotateTowards } from '../core/math';
import type { EnemyAttackDef, EnemyDef } from './data/enemies';

/**
 * 敵の sim 側（three に依存しない。見た目は src/game/enemy-visual.ts）。
 *
 * 状態機械:
 *   idle（出現直後の待ち。プレイヤーが範囲内なら chase）
 *   chase（プレイヤーの方を向いて近づく。stopDistance で止まり、攻撃の距離で待ちが明けていれば windup）
 *   windup（予備動作 = テレグラフ。windupTrackFrames まではプレイヤーを向き続け、そのあと向きを固定する）
 *   attack（startup → active（判定が出る。前へ踏み込む）→ recover = 硬直）→ chase
 *   hit（ひるみ。windup の前半は中断される。後半から attack の終わりまではスーパーアーマー = 弱い攻撃ではひるまず、重撃だけが割り込める）→ chase
 *   dead（死亡演出のあと removable）
 * プレイヤーが倒れたら（targetAlive = false）、idle に戻って何もしない。
 *
 * stateFrame の約束は Player と同じ: step() の後に読むと「その状態に入ってから進んだ sim フレーム」で、
 * 描画されている姿勢の時刻に一致する（入った step の直後が 1）。
 */

export type EnemyState = 'idle' | 'chase' | 'windup' | 'attack' | 'recover' | 'hit' | 'dead';

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
  /** この攻撃で当てた対象の記録（1 攻撃 1 対象 1 回）。攻撃に入るたびにリセットする */
  readonly hitTracker = new HitTracker();
  /** 死亡の演出が終わって取り除いてよい */
  removable = false;
  /** 次の予備動作に入れるまでの残り（硬直が明けてから数える） */
  private cooldown = 0;
  /** 攻撃の踏み込みの向き（予備動作で固定した向き） */
  private lungeDirX = 0;
  private lungeDirZ = 1;

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

  get attackDef(): EnemyAttackDef {
    return this.def.attack;
  }

  /** 予備動作〜攻撃中か（同時に攻撃できる数の制限＝攻撃権の数え方に使う） */
  get attacking(): boolean {
    return this.state === 'windup' || this.state === 'attack';
  }

  /** 攻撃の判定が出ているフレームか（ヒット判定の入力）。step() の後に読む */
  get attackActive(): boolean {
    const a = this.def.attack;
    return this.state === 'attack' && isActiveFrame(a.startupFrames, a.activeFrames, this.stateFrame);
  }

  /** 位置と向きを設定する（スポーン直後に補間が前の位置から滑らないよう、前ステップも揃える） */
  place(x: number, z: number, yaw: number): void {
    this.body.x = this.prevX = x;
    this.body.z = this.prevZ = z;
    this.yaw = this.prevYaw = yaw;
  }

  /** スーパーアーマー中か（予備動作の後半〜攻撃の終わり）。ev のダメージが armorBreakDamage 未満ならひるまない */
  get armored(): boolean {
    const a = this.def.attack;
    return (this.state === 'windup' && this.stateFrame >= a.armorFromFrame) || this.state === 'attack';
  }

  /**
   * 被弾。ダメージを適用し、ひるみ（または死亡）に入ってノックバックを始める。
   * スーパーアーマー中の弱い攻撃は、ダメージとノックバック（小）だけが通り、状態は変わらない（攻撃を続ける）
   */
  takeHit(ev: HitEvent): DamageResult {
    const r = applyDamage(this.health, ev.damage);
    if (this.dead) return r;
    this.hitSerial++;
    this.lastHit = ev;
    const armor = this.def.attack;
    const holds = !r.killed && this.armored && ev.damage < armor.armorBreakDamage;
    const scale = this.def.knockbackScale * (holds ? armor.armorKnockbackScale : 1);
    this.knockback.start(ev.dirX, ev.dirZ, ev.knockback * scale, this.def.knockbackFrames);
    if (r.killed) {
      this.body.invulnerable = true;
      this.setState('dead');
    } else if (!holds) {
      this.setState('hit', true);
    }
    return r;
  }

  /**
   * canAttack は攻撃権（Game が、同時に攻撃している敵の数が上限未満かで決める）。false のあいだは、攻撃の距離に入っても
   * 予備動作に入らず、近くで構えて待つ
   */
  step(dt: number, targetX: number, targetZ: number, targetAlive = true, canAttack = true): void {
    this.prevX = this.body.x;
    this.prevZ = this.body.z;
    this.prevYaw = this.yaw;

    const def = this.def;
    const atk = def.attack;
    const dx = targetX - this.body.x;
    const dz = targetZ - this.body.z;
    const dist = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(dx, dz);
    let moveX = 0;
    let moveZ = 0;
    if (this.cooldown > 0) this.cooldown--;

    switch (this.state) {
      case 'idle':
        this.faceTarget(wantYaw, dt);
        if (targetAlive && this.stateFrame >= def.spawnIdleFrames && dist <= def.aggroRange) this.setState('chase');
        break;
      case 'chase':
        if (!targetAlive) {
          this.setState('idle');
          break;
        }
        this.faceTarget(wantYaw, dt);
        if (dist > def.stopDistance) {
          // 向いている方向へ進む（向き直りが追いつくまでは膨らんで追う）
          moveX = Math.sin(this.yaw) * def.moveSpeed;
          moveZ = Math.cos(this.yaw) * def.moveSpeed;
        }
        if (dist <= atk.range && this.cooldown <= 0 && canAttack) this.setState('windup');
        break;
      case 'windup':
        if (!targetAlive) {
          this.setState('idle');
          break;
        }
        // 前半はプレイヤーを追って向き、後半は向きを固定する（横へ動けば当たらない）
        if (this.stateFrame < atk.windupTrackFrames) this.faceTarget(wantYaw, dt);
        if (this.stateFrame >= atk.windupFrames) {
          this.lungeDirX = Math.sin(this.yaw);
          this.lungeDirZ = Math.cos(this.yaw);
          this.hitTracker.reset();
          this.setState('attack');
        }
        break;
      case 'attack': {
        // 判定が出ているあいだ前へ踏み込む（stateFrame は読み出し時の約束で 1 つ進んでいるので、次の 1 フレームぶん）
        if (isActiveFrame(atk.startupFrames, atk.activeFrames, this.stateFrame + 1)) {
          const v = atk.lunge / (atk.activeFrames / 60);
          moveX = this.lungeDirX * v;
          moveZ = this.lungeDirZ * v;
        }
        if (this.stateFrame >= atk.startupFrames + atk.activeFrames + atk.recoverFrames) {
          this.cooldown = atk.cooldownFrames;
          this.setState('chase');
        }
        break;
      }
      case 'hit':
        if (this.stateFrame >= def.hitStunFrames) this.setState(targetAlive ? 'chase' : 'idle');
        break;
      case 'dead':
        if (this.stateFrame >= def.deathFrames) this.removable = true;
        break;
    }

    this.body.x += (moveX + this.knockback.velX) * dt;
    this.body.z += (moveZ + this.knockback.velZ) * dt;
    this.knockback.step();
    this.stateFrame++;
  }

  private faceTarget(wantYaw: number, dt: number): void {
    this.yaw = rotateTowards(this.yaw, wantYaw, this.def.turnSpeed * dt);
  }

  private setState(s: EnemyState, forceRestart = false): void {
    if (this.state === s && !forceRestart) return;
    this.state = s;
    this.stateFrame = 0;
  }
}
