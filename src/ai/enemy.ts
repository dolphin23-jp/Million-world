import { applyDamage, createHealth, type DamageResult, type Health } from '../combat/health';
import { HitTracker, isActiveFrame, type HitEvent, type Hurtbox } from '../combat/hit';
import { Knockback } from '../combat/knockback';
import { Poise } from '../combat/poise';
import { clamp, rotateTowards } from '../core/math';
import { PARRY_EFFECTS, type ParryEffectDef } from '../combat/data/guard';
import { PROJECTILES, type ProjectileId } from '../combat/data/projectiles';
import type { EnemyAttackDef, EnemyDef } from './data/enemies';
import { fanOffset } from '../combat/projectile';
import { FLYING_Y, type World } from '../world/world';
import { createSteerState, steerYaw } from './steering';
import { PROJECTILE_HEIGHT } from '../combat/data/projectiles';
import { REACH } from '../combat/data/reach';
import { canSee, sightHeight, verticalReach } from '../combat/reach';

/**
 * 敵の sim 側（three に依存しない。見た目は src/game/enemy-visual.ts）。
 *
 * 状態機械:
 *   idle（出現直後の待ち。プレイヤーが範囲内なら chase）
 *   chase（プレイヤーの方を向いて近づく。stopDistance で止まり、攻撃の距離で待ちが明けていれば windup。
 *     距離を取る敵（retreatDistance）は、近づかれると向きを保ったまま後ろへ下がる。
 *     世界（world）があれば、近づくあいだ障害物に塞がれていたら、通れる向きへ回り込む = 迂回。M7-4a。ADR-043。
 *     プレイヤーが見えない（視線が柱・高い箱に遮られる）あいだ、また届かない高さ（登った縁の上など）にいるあいだは、攻撃の予備動作に入らない。
 *     見えないあいだは、止まる距離・周回・後退より優先して見える位置まで寄る。M7-4b。ADR-044）
 *   windup（予備動作 = テレグラフ。windupTrackFrames まではプレイヤーを向き続け、そのあと向きを固定する）
 *   attack（startup → active（判定が出る。前へ踏み込む）→ recover = 硬直）→ chase
 *     飛び道具の攻撃（projectile）は、近接の判定が出ず、startup で固定した向きへ弾を 1 つ撃つ（fireSerial / shot。弾の sim は src/combat/projectile.ts）
 *   hit（ひるみ。windup の前半は中断される。後半から attack の終わりまではスーパーアーマー = 弱い攻撃ではひるまず、重撃だけが割り込める）→ chase
 *   体勢ゲージ（poise。重装型）: 攻撃を受けるたびに減り、0 になると stagger に入る（予備動作・攻撃も中断。反撃の窓は POISE_BREAK）。立て直すと満タン
 *   stagger / down（パリィで攻撃を弾かれる。スーパーアーマーを無視して予備動作・攻撃を中断する。どちらも parryEffect.frames のあいだ動けず、
 *     攻撃を受けてもひるみに割り込まれない。弾かれてから riposteFrames までに当てた攻撃は反撃として大きなダメージになる = riposte）→ chase
 *     stagger = 盾のパリィ: その場でのけぞって立ったまま崩れる。down = 大剣のパリィ: 大きく弾き飛ばされて倒れ、起き上がるまで長い）
 *   dead（死亡演出のあと removable）
 * プレイヤーが倒れたら（targetAlive = false）、idle に戻って何もしない。
 *
 * stateFrame の約束は Player と同じ: step() の後に読むと「その状態に入ってから進んだ sim フレーム」で、
 * 描画されている姿勢の時刻に一致する（入った step の直後が 1）。
 */

/** 飛び道具を撃った瞬間の弾の出どころ（Game が読んで Projectile を作る） */
export interface Shot {
  projectile: ProjectileId;
  /** 銃口（敵の中心から向きへ muzzle ぶん前）と、撃つ向き（単位ベクトル。扇・輪では中心の向き） */
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  /** 撃つ本数と扇の広がり（rad。ADR-029。通常は 1 本・広がり 0）。i 本目の向きは fanOffset(i, count, spread) だけ中心の向きから回した向き */
  count: number;
  spread: number;
  /** 弾のダメージ・弾き返したときのダメージの倍率（敵の段階。ADR-036。通常は 1） */
  damageScale: number;
  reflectScale: number;
}

/** 複数の技を持つ敵が、いまの段階・距離で選べる技か */
function eligible(m: EnemyAttackDef, phase: number, dist: number): boolean {
  return (m.minPhase ?? 0) <= phase && dist <= m.range && dist >= (m.rangeMin ?? 0);
}

export type EnemyState = 'idle' | 'chase' | 'windup' | 'attack' | 'recover' | 'hit' | 'stagger' | 'down' | 'dead';

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
  /** パリィで弾かれるたびに増える（見た目側が反応を起こすため） */
  parrySerial = 0;
  /** 体勢ゲージ（重装型だけ。なければ null）と、体勢を崩されるたびに増える数（Game が演出を起こすため） */
  readonly poise: Poise | null;
  breakSerial = 0;
  /** 直近に弾かれたときの効果（stagger / down の長さ・反撃の倍率。stagger・down のあいだ有効） */
  parryEffect: ParryEffectDef = PARRY_EFFECTS.stagger;
  /** この攻撃で当てた対象の記録（1 攻撃 1 対象 1 回）。攻撃に入るたびにリセットする */
  readonly hitTracker = new HitTracker();
  /** 状態が切り替わるたびに増える（効果音など、遷移の瞬間に反応する側が検出するため） */
  stateSerial = 0;
  /** 死亡の演出が終わって取り除いてよい */
  removable = false;
  /**
   * 障害物を避けて追うための世界（Game が出現のときに渡す。null なら迂回せず、まっすぐ追う = 障害物は押し出しで滑るだけ）と、迂回の状態
   */
  world: World | null = null;
  private readonly steer = createSteerState();
  /** プレイヤーが見えているか（world があれば、毎ステップ視線を調べる。なければ常に true）。見えないあいだは攻撃に入らず、見える位置まで寄る */
  sight = true;
  /** 技のどれかに召喚・飛び道具があるか、近接の技があるか、飛び道具の技だけか（届き・視線の判定。def から決まる） */
  private readonly hasMelee: boolean;
  private readonly hasRanged: boolean;
  private readonly rangedOnly: boolean;
  /** 次の予備動作に入れるまでの残り（硬直が明けてから数える） */
  private cooldown = 0;
  /** 攻撃の踏み込みの向き（予備動作で固定した向き） */
  private lungeDirX = 0;
  private lungeDirZ = 1;
  /** 攻撃（突進）に入った位置。床の予告の帯が、動いている敵ではなく出発点に付くよう、見た目側が読む（ADR-025） */
  attackOriginX = 0;
  attackOriginZ = 0;
  /** 飛び道具を撃つたびに増える（Game が弾を作るため）と、直近の弾の出どころ */
  fireSerial = 0;
  readonly shot: Shot = { projectile: 'wisp', x: 0, z: 0, dirX: 0, dirZ: 1, count: 1, spread: 0, damageScale: 1, reflectScale: 1 };
  /** 段階（ボス。ADR-029）が上がるたびに増える（Game が演出を起こすため） */
  phaseSerial = 0;
  /** 召喚（ボス）の判定が出るたびに増える（Game が手下を出すため）と、その内容 */
  summonSerial = 0;
  summon: { readonly type: string; readonly count: number; readonly radius: number; readonly max: number } | null = null;
  /** いまの技（複数の技を持つ敵は、攻撃に入るたびに選び直す。ほかは def.attack のまま）と、直前の技 */
  private move: EnemyAttackDef;
  private lastMove: EnemyAttackDef | null = null;
  /** 技の選択に使う乱数（敵の id から決まる種。同じ状況なら同じ選び方 = テストできる） */
  private rngState: number;
  /** 周回する向き（+1 / −1）。id で決まり、攻撃を終えるたびに逆になる */
  private orbitSide: number;
  /** この攻撃で、もう撃った・地面を叩いたか（攻撃に入るたびに false） */
  private fired = false;
  /** 地面を叩く攻撃の判定が出るたびに増える（Game が床の演出を起こすため） */
  impactSerial = 0;

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
    this.poise = def.poise ? new Poise(def.poise) : null;
    this.orbitSide = id % 2 === 0 ? 1 : -1;
    this.move = def.attack;
    this.rngState = (Math.imul(id + 1, 2654435761) >>> 0) || 1;
    const moves = def.moves ?? [def.attack];
    this.hasMelee = moves.some((m) => !m.projectile && !m.summon);
    this.hasRanged = moves.some((m) => m.projectile !== undefined || m.summon !== undefined);
    this.rangedOnly = moves.every((m) => m.projectile !== undefined);
    this.prevX = x;
    this.prevZ = z;
  }

  get id(): number {
    return this.body.id;
  }

  /** 足の高さ（m。飛ぶ敵は FLYING_Y、歩く敵は地面）と、背の高さ。近接の縦の届き・視線の高さに使う（M7-4b） */
  get y(): number {
    return this.def.flying ? FLYING_Y : 0;
  }

  get height(): number {
    return this.def.height;
  }

  /**
   * 足の高さ targetY のプレイヤーに、技のどれかで届くか（予備動作に入ってよいか。M7-4b）。召喚（どこにいても）、飛び道具（足が弾の高さ以下。弾は足の下を通る）、
   * 近接（背の高さ + 腕で縦に重なる。技ごとの低さ reachTop は見ない = 低い突進を持つ敵も、跳んでいる相手に構えはする）
   */
  canReach(targetY: number): boolean {
    if (this.hasRanged) {
      const moves = this.def.moves ?? [this.def.attack];
      for (const m of moves) {
        if (m.summon) return true;
        if (m.projectile && targetY <= PROJECTILE_HEIGHT) return true;
      }
    }
    return this.hasMelee && verticalReach(this.y, this.def.height, targetY, REACH.playerHeight);
  }

  /** 視線を調べる高さ。飛び道具だけの敵は弾の高さ（柱は遮るが、低い岩・壁の上は通る）。ほかは、敵とプレイヤーの目の高い方（低い岩・壁・登った縁は遮らない） */
  private sightY(targetY: number): number {
    if (this.rangedOnly) return PROJECTILE_HEIGHT;
    return sightHeight(this.y, targetY);
  }

  get dead(): boolean {
    return this.state === 'dead';
  }

  /** いまの技（予備動作に入るたびに選ばれる。複数の技を持たない敵は常に def.attack） */
  get attackDef(): EnemyAttackDef {
    return this.move;
  }

  /** 段階（0 始まり。HP の割合が def.phases の hpBelow 以下になるたびに 1 つ上がる） */
  get phase(): number {
    const phases = this.def.phases;
    if (!phases) return 0;
    const ratio = this.health.hp / this.health.max;
    let n = 0;
    for (const p of phases) if (ratio <= p.hpBelow) n++;
    return n;
  }

  /** 0..1 の乱数（xorshift32） */
  private random(): number {
    let x = this.rngState;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.rngState = x || 1;
    return this.rngState / 4294967296;
  }

  /**
   * プレイヤーまで dist のとき、次に使える技を選ぶ（なければ null = まだ攻撃に入らない）。
   * 複数の技がなければ、攻撃の距離（range）以内のときの def.attack。あれば、段階・距離で選べる技から、重みで選ぶ（直前の技は、ほかに選べる技があれば避ける）
   */
  private pickMove(dist: number): EnemyAttackDef | null {
    const moves = this.def.moves;
    if (!moves) return dist <= this.def.attack.range ? this.def.attack : null;
    const phase = this.phase;
    let n = 0;
    let total = 0;
    for (const m of moves) {
      if (!eligible(m, phase, dist)) continue;
      n++;
      if (m !== this.lastMove) total += m.weight ?? 1;
    }
    if (n === 0) return null;
    // 選べる技が 1 つだけなら、それ（直前と同じでも）
    if (n === 1) {
      for (const m of moves) if (eligible(m, phase, dist)) return m;
    }
    // 重み付きの乱数で、直前の技を除いて選ぶ
    let r = this.random() * total;
    let pick: EnemyAttackDef | null = null;
    for (const m of moves) {
      if (m === this.lastMove || !eligible(m, phase, dist)) continue;
      pick = m;
      r -= m.weight ?? 1;
      if (r <= 0) break;
    }
    return pick;
  }

  /** 倒されずに消える（ボスが倒れたときの手下。倒した数には入らない）。死亡の演出（deathFrames）のあと取り除かれる */
  vanish(): void {
    if (this.dead) return;
    this.body.invulnerable = true;
    this.setState('dead');
  }

  /** 予備動作〜攻撃中か（同時に攻撃できる数の制限＝攻撃権の数え方に使う） */
  get attacking(): boolean {
    return this.state === 'windup' || this.state === 'attack';
  }

  /** 攻撃権の予算を使う重み（既定 1） */
  get attackWeight(): number {
    return this.def.attackWeight ?? 1;
  }

  /** 攻撃の判定が出ているフレームか（ヒット判定の入力）。step() の後に読む */
  get attackActive(): boolean {
    const a = this.move;
    // 飛び道具・召喚の攻撃に近接の判定は無い（当たるのは撃った弾）
    return this.state === 'attack' && !a.projectile && !a.summon && isActiveFrame(a.startupFrames, a.activeFrames, this.stateFrame);
  }

  /** 位置と向きを設定する（スポーン直後に補間が前の位置から滑らないよう、前ステップも揃える） */
  place(x: number, z: number, yaw: number): void {
    this.body.x = this.prevX = x;
    this.body.z = this.prevZ = z;
    this.yaw = this.prevYaw = yaw;
  }

  /** 弾かれて動けない状態か（体勢を崩している stagger・倒れている down）。ひるみに割り込まれず、何度当たっても同じ状態のまま */
  get held(): boolean {
    return this.state === 'stagger' || this.state === 'down';
  }

  /**
   * 反撃を受ける状態なら、その効果（ダメージ・ノックバックの倍率。src/game/combat.ts が読む）。そうでなければ null。
   * 弾かれてから riposteFrames まで（stateFrame は弾いた step で 0、次の step から 1, 2, …）
   */
  get riposte(): ParryEffectDef | null {
    return this.held && this.stateFrame <= this.parryEffect.riposteFrames ? this.parryEffect : null;
  }

  /**
   * プレイヤーに攻撃をパリィで弾かれた。予備動作・攻撃を中断して、effect の状態（stagger = 体勢を崩す / down = 倒れる）に入り、
   * プレイヤーから離れる向きへ押される。スーパーアーマーは効かない（パリィは割り込みではなく、攻撃そのものを弾く）。
   * ev は敵 → プレイヤーの攻撃の結果
   */
  parried(ev: HitEvent, effect: ParryEffectDef = PARRY_EFFECTS.stagger): void {
    if (this.dead) return;
    this.parrySerial++;
    this.parryEffect = effect;
    this.knockback.start(-ev.dirX, -ev.dirZ, effect.enemyKnockback * this.def.knockbackScale, effect.knockbackFrames || this.def.knockbackFrames);
    this.setState(effect.id, true);
  }

  /** 体勢を崩された: 予備動作・攻撃を中断して、その場で動けなくなる（弾かれたときと同じ stagger。倍率・長さは def.poise.breakEffect） */
  private breakPoise(ev: HitEvent): void {
    const effect = this.def.poise!.breakEffect;
    this.breakSerial++;
    this.parryEffect = effect;
    this.knockback.start(ev.dirX, ev.dirZ, ev.knockback * this.def.knockbackScale * effect.riposteKnockbackScale, this.def.knockbackFrames);
    this.setState(effect.id, true);
  }

  /** スーパーアーマー中か（予備動作の後半〜攻撃の終わり。hyperArmor の敵はいつでも）。ev のダメージが armorBreakDamage 未満ならひるまない */
  get armored(): boolean {
    if (this.def.hyperArmor) return true;
    const a = this.move;
    return (this.state === 'windup' && this.stateFrame >= a.armorFromFrame) || this.state === 'attack';
  }

  /**
   * 被弾。ダメージを適用し、ひるみ（または死亡）に入ってノックバックを始める。
   * スーパーアーマー中の弱い攻撃は、ダメージとノックバック（小）だけが通り、状態は変わらない（攻撃を続ける）
   */
  takeHit(ev: HitEvent): DamageResult {
    const phaseBefore = this.phase;
    const r = applyDamage(this.health, ev.damage);
    if (this.dead) return r;
    this.hitSerial++;
    this.lastHit = ev;
    if (!r.killed && this.phase > phaseBefore) this.phaseSerial++;
    const armor = this.move;
    // 弾かれて動けないあいだは、何度当てても同じ状態のまま（ひるみで状態が上書きされない。ノックバックは反撃の倍率で小さくしてある）
    const staggered = this.held;
    // 体勢ゲージ: 予備動作・攻撃の最中でも減る。崩れたら、そのまま動けない状態（反撃の窓）に入る（死んだ一撃は崩さない）
    if (!r.killed && !staggered && this.poise && this.poise.hit(ev.damage)) {
      this.breakPoise(ev);
      return r;
    }
    const holds = !r.killed && (staggered || (this.armored && ev.damage < armor.armorBreakDamage));
    const scale = this.def.knockbackScale * (staggered ? 1 : holds ? armor.armorKnockbackScale : 1);
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
  step(dt: number, targetX: number, targetZ: number, targetAlive = true, canAttack = true, targetY = 0): void {
    this.prevX = this.body.x;
    this.prevZ = this.body.z;
    this.prevYaw = this.yaw;

    const def = this.def;
    const atk = this.move;
    const dx = targetX - this.body.x;
    const dz = targetZ - this.body.z;
    const dist = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(dx, dz);
    let moveX = 0;
    let moveZ = 0;
    // 視線: 柱・高い箱に遮られていれば、見えるまで寄る（止まる距離・周回・後退より優先）。world がなければ遮るものは無い
    this.sight = this.world === null || canSee(this.world, this.body.x, this.body.z, targetX, targetZ, this.sightY(targetY));
    const seeking = !this.sight;
    if (this.cooldown > 0) this.cooldown--;
    if (this.poise && !this.held && this.state !== 'dead') this.poise.step();

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
        // 近づくあいだは、障害物に塞がれていれば通れる向きへ回り込む（周回・後退・止まる距離の中では、プレイヤーの方を向く）
        this.faceTarget(this.approachYaw(wantYaw, dist, targetX, targetZ, seeking), dt);
        if (def.orbitSpeed !== undefined && dist < def.stopDistance + 1.8 && !seeking) {
          // 周回: 輪（stopDistance）を保ちながら、プレイヤーの周りを回る（向いている方向に対して横）
          const radial = clamp((dist - def.stopDistance) * 2.5, -def.moveSpeed, def.moveSpeed);
          const side = this.orbitSide * def.orbitSpeed;
          moveX = Math.sin(this.yaw) * radial + Math.cos(this.yaw) * side;
          moveZ = Math.cos(this.yaw) * radial - Math.sin(this.yaw) * side;
        } else if (def.retreatDistance !== undefined && dist < def.retreatDistance && !seeking) {
          // 近づかれたら、向きを保ったまま後ろへ下がる（距離を取って撃つ敵）
          const v = def.retreatSpeed ?? def.moveSpeed;
          moveX = -Math.sin(this.yaw) * v;
          moveZ = -Math.cos(this.yaw) * v;
        } else if (dist > def.stopDistance || seeking) {
          // 向いている方向へ進む（向き直りが追いつくまでは膨らんで追う）
          moveX = Math.sin(this.yaw) * def.moveSpeed;
          moveZ = Math.cos(this.yaw) * def.moveSpeed;
        }
        if (this.cooldown <= 0 && canAttack && this.sight && this.canReach(targetY)) {
          const next = this.pickMove(dist);
          if (next) {
            this.move = next;
            this.setState('windup');
          }
        }
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
          this.attackOriginX = this.body.x;
          this.attackOriginZ = this.body.z;
          this.hitTracker.reset();
          this.fired = false;
          this.setState('attack');
        }
        break;
      case 'attack': {
        // 判定が出ているあいだ前へ踏み込む（stateFrame は読み出し時の約束で 1 つ進んでいるので、次の 1 フレームぶん）
        if (isActiveFrame(atk.startupFrames, atk.activeFrames, this.stateFrame + 1)) {
          const v = atk.lunge / (atk.activeFrames / 60);
          moveX = this.lungeDirX * v;
          moveZ = this.lungeDirZ * v;
          if (atk.projectile && !this.fired) this.fire(atk.projectile);
          if (atk.groundImpact !== undefined && !this.fired) {
            this.fired = true;
            this.impactSerial++;
          }
          if (atk.summon && !this.fired) {
            this.fired = true;
            this.summon = atk.summon;
            this.summonSerial++;
          }
        }
        if (this.stateFrame >= atk.startupFrames + atk.activeFrames + atk.recoverFrames) {
          this.cooldown = Math.round(atk.cooldownFrames * this.cooldownScale);
          this.lastMove = atk;
          this.orbitSide = -this.orbitSide;
          this.setState('chase');
        }
        break;
      }
      case 'hit':
        if (this.stateFrame >= def.hitStunFrames) this.setState(targetAlive ? 'chase' : 'idle');
        break;
      case 'stagger':
      case 'down':
        if (this.stateFrame >= this.parryEffect.frames) {
          this.poise?.refill();
          this.cooldown = this.parryEffect.recoverCooldownFrames;
          this.setState(targetAlive ? 'chase' : 'idle');
        }
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

  /** chase で向く向き: 近づいている最中（周回・後退・止まる距離の外）で、世界があれば、障害物を避ける向き。それ以外はプレイヤーの方（wantYaw） */
  private approachYaw(wantYaw: number, dist: number, targetX: number, targetZ: number, seeking: boolean): number {
    const def = this.def;
    if (!this.world) return wantYaw;
    if (!seeking) {
      if (dist <= def.stopDistance) return wantYaw;
      if (def.orbitSpeed !== undefined && dist < def.stopDistance + 1.8) return wantYaw;
      if (def.retreatDistance !== undefined && dist < def.retreatDistance) return wantYaw;
    }
    return steerYaw(this.world, this.body.x, this.body.z, def.radius, def.flying ? FLYING_Y : 0, targetX, targetZ, this.steer, this.orbitSide);
  }

  /** いまの段階の、技のあとの待ちの倍率（1 = そのまま） */
  private get cooldownScale(): number {
    const phases = this.def.phases;
    if (!phases) return 1;
    const p = this.phase;
    return p > 0 ? (phases[p - 1]?.cooldownScale ?? 1) : 1;
  }

  /** 固定した向きへ飛び道具を撃つ（予備動作で向きを固定してあるので、横へ動けば当たらない） */
  private fire(id: ProjectileId): void {
    this.fired = true;
    const s = this.shot;
    const atk = this.move;
    const reach = PROJECTILES[id].muzzle + (atk.muzzleOffset ?? 0);
    s.projectile = id;
    s.dirX = this.lungeDirX;
    s.dirZ = this.lungeDirZ;
    s.x = this.body.x + this.lungeDirX * reach;
    s.z = this.body.z + this.lungeDirZ * reach;
    s.count = atk.projectileCount ?? 1;
    s.spread = atk.projectileSpread ?? 0;
    s.damageScale = atk.projectileDamageScale ?? 1;
    s.reflectScale = atk.projectileReflectScale ?? 1;
    this.fireSerial++;
  }

  private faceTarget(wantYaw: number, dt: number): void {
    this.yaw = rotateTowards(this.yaw, wantYaw, this.def.turnSpeed * dt);
  }

  private setState(s: EnemyState, forceRestart = false): void {
    if (this.state === s && !forceRestart) return;
    this.state = s;
    this.stateFrame = 0;
    this.stateSerial++;
  }
}
