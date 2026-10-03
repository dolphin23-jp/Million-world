import * as THREE from 'three';
import { GameLoop } from '../core/loop';
import { InputAggregator, type InputIntent } from '../input/intent';
import { TouchInput } from '../input/touch';
import { KeyboardInput } from '../input/keyboard';
import { RendererHost } from '../render/renderer';
import { PostPipeline } from '../render/post';
import { AdaptiveResolution, buildLevels } from '../render/adaptive-resolution';
import { SkyDome } from '../render/sky';
import { Arena } from '../world/arena';
import { clampInsideArena, pushOutOfCircle, separateCircles } from '../world/collision';
import { Player } from './player';
import { resolveEnemyAttacks, resolvePlayerAttack } from './combat';
import { Enemy } from '../ai/enemy';
import { stepSwarm } from '../ai/swarm';
import { ENEMIES } from '../ai/data/enemies';
import { EnemyVisual } from './enemy-visual';
import { HitStop } from '../core/hitstop';
import { HitFx } from '../render/hit-fx';
import { SwordTrail } from '../render/sword-trail';
import { DamageNumbers } from '../ui/damage-numbers';
import { EnemyBars } from '../ui/enemy-bars';
import { LockMarker } from '../ui/lock-marker';
import { LockOn } from '../combat/lockon-state';
import { Encounter, spawnPoint, type EncounterEvent } from './encounter';
import { DEMO_ENCOUNTER, type EncounterDef } from '../ai/data/encounters';
import type { Hurtbox } from '../combat/hit';
import { hitFeedback } from '../combat/feedback';
import { HIT_FEEDBACK } from '../combat/data/hit-feedback';
import type { HitEvent } from '../combat/hit';
import type { DamageResult } from '../combat/health';
import { ThirdPersonCamera } from './camera';
import { Hud } from '../ui/hud';
import { onVisibility } from '../platform/safari';
import { loadCharacter } from '../character/loader';
import { HERO } from '../character/data/hero';

/**
 * ゲーム全体を束ねる。sim（step）と render を分け、sim は InputIntent だけを入力に取る。
 */

const _pos = new THREE.Vector3();
const _bladeBase = new THREE.Vector3();
const _bladeTip = new THREE.Vector3();
const SUN_DIR = new THREE.Vector3(0.55, 0.75, 0.35).normalize();

export interface GameOptions {
  canvas: HTMLCanvasElement;
  debug?: boolean;
  /** 描画の pixelRatio を固定する（動的解像度を止める）。?dpr= から渡す */
  pixelRatio?: number;
  /** false で動的解像度を止める（既定は有効）。?adaptive=0 から渡す */
  adaptive?: boolean;
}

/** 動的解像度の段（大きい順）。デバイスの DPR を超える段は buildLevels が潰す */
const PIXEL_RATIO_LEVELS = [1.5, 1.25, 1.0];

/** 敵 1 体ぶんの sim と見た目 */
interface EnemyEntry {
  enemy: Enemy;
  visual: EnemyVisual;
}

/** 最後の敵を倒したときのスローモーション（倍率、実時間の秒） */
const FINISH_SLOW = { scale: 0.3, seconds: 0.9 };
/** プレイヤーが倒れたときのスローモーション */
const DEFEAT_SLOW = { scale: 0.35, seconds: 1.2 };

export class Game {
  readonly host: RendererHost;
  readonly scene = new THREE.Scene();
  readonly cam: ThirdPersonCamera;
  readonly post: PostPipeline;
  readonly sky: SkyDome;
  readonly arena: Arena;
  readonly player: Player;
  readonly enemies: EnemyEntry[] = [];
  /** enemies の sim だけを並べた配列（毎ステップ配列を作らないため。spawn / 取り除きで同期する） */
  private readonly enemySims: Enemy[] = [];
  private nextEnemyId = 1;
  /** 戦闘の進行（ウェーブ・勝敗・リザルトの集計）。再戦のたびに作り直す */
  encounter: Encounter = new Encounter(DEMO_ENCOUNTER);
  readonly hitStop = new HitStop();
  readonly hitFx = new HitFx();
  readonly damageNumbers: DamageNumbers;
  readonly enemyBars: EnemyBars;
  readonly lockMarker: LockMarker;
  /** ロックオンの状態。対象は敵の id */
  readonly lockOn = new LockOn();
  /** ロックできる敵の体（生きているものだけ。毎ステップ作り直して使い回す） */
  private readonly lockCands: Hurtbox[] = [];
  private lockIndicator = false;
  readonly swordTrail = new SwordTrail();
  readonly input = new InputAggregator();
  readonly touch: TouchInput;
  readonly hud: Hud;
  readonly loop: GameLoop;
  readonly adaptive: AdaptiveResolution;
  private readonly startTime = performance.now();
  /** 開発用: 外部（スクリーンショットツール等）から入力を注入する */
  private injected: Partial<InputIntent> | null = null;
  /** 資産の読込が終わり start() できる状態か */
  ready = false;

  constructor(opts: GameOptions) {
    this.adaptive = new AdaptiveResolution({ levels: buildLevels(window.devicePixelRatio || 1, PIXEL_RATIO_LEVELS) });
    if (opts.pixelRatio !== undefined || opts.adaptive === false) this.adaptive.lock();
    this.host = new RendererHost({ canvas: opts.canvas, maxPixelRatio: opts.pixelRatio ?? this.adaptive.ratio });
    this.cam = new ThirdPersonCamera(this.host.width / this.host.height);
    this.hud = new Hud();
    this.hud.setDebugVisible(opts.debug ?? true);
    this.damageNumbers = new DamageNumbers(document.getElementById('fx-layer')!);
    this.enemyBars = new EnemyBars(document.getElementById('fx-layer')!);
    this.lockMarker = new LockMarker(document.getElementById('fx-layer')!);

    // --- シーン ---
    this.scene.fog = new THREE.Fog(0xbfd9ff, 30, 120);
    this.sky = new SkyDome(undefined, SUN_DIR);
    this.scene.add(this.sky.mesh);

    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x6a5a92, 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
    sun.position.copy(SUN_DIR).multiplyScalar(30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 80;
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun);
    this.scene.add(sun.target);

    this.arena = new Arena();
    this.scene.add(this.arena.group);

    this.player = new Player();
    this.scene.add(this.player.root);
    this.scene.add(this.hitFx.group);
    this.scene.add(this.swordTrail.mesh);
    this.hud.onRetry(() => this.restart());
    this.startEncounter();

    // --- 入力 ---
    this.touch = new TouchInput();
    this.input.add(this.touch);
    this.input.add(new KeyboardInput());
    this.input.add({
      collect: (it) => {
        if (!this.injected) return;
        Object.assign(it, this.injected);
      },
      endStep: () => {
        this.injected = null;
      },
    });

    // --- ポストプロセス ---
    this.post = new PostPipeline(this.host.renderer, this.scene, this.cam.camera, {
      bloomStrength: 0.32,
      bloomRadius: 0.45,
      bloomThreshold: 0.8,
      samples: 4,
    });
    this.host.onResize = (w, h, pr) => {
      this.cam.setAspect(w / h);
      this.post.setSize(w, h, pr);
    };
    this.host.applySize();

    // --- ループ ---
    this.loop = new GameLoop({
      step: (dt) => this.step(dt),
      render: (alpha, frameDt) => this.render(alpha, frameDt),
    });
    onVisibility((visible) => {
      if (visible) {
        if (!this.loop.isRunning) this.loop.start();
      } else {
        this.loop.stop();
      }
    });
  }

  /** 資産を読み込む。開始前に 1 度呼ぶ */
  async preload(): Promise<void> {
    const asset = await loadCharacter(`${import.meta.env.BASE_URL}${HERO.url}`);
    this.player.attachVisual(asset);
    this.ready = true;
  }

  start(): void {
    if (!this.ready) throw new Error('preload() が終わっていません');
    this.loop.start();
  }

  /** 開発用: 次の sim ステップに入力を 1 回だけ注入する */
  inject(intent: Partial<InputIntent>): void {
    this.injected = intent;
  }

  /** 開発用: 指定ステップ数だけ即座に sim を進める（スクリーンショット用） */
  stepNow(count: number): void {
    for (let i = 0; i < count; i++) this.step(1 / 60);
  }

  /**
   * 開発用: 描画を 1/60 秒刻みで指定回数だけ即座に行う。ループを止めてスクリーンショットを撮るとき、
   * 実時間で減衰する演出（フラッシュ・揺れ）を決まった状態にするために使う
   */
  renderNow(count = 1): void {
    for (let i = 0; i < count; i++) this.render(1, 1 / 60);
  }

  /** 敵を 1 体、(x, z) に出す。プレイヤーの方を向く */
  spawnEnemy(type: keyof typeof ENEMIES, x: number, z: number): Enemy {
    const enemy = new Enemy(ENEMIES[type], this.nextEnemyId++, x, z);
    enemy.place(x, z, Math.atan2(this.player.body.x - x, this.player.body.z - z));
    const visual = new EnemyVisual();
    this.scene.add(visual.root);
    this.enemies.push({ enemy, visual });
    this.enemySims.push(enemy);
    return enemy;
  }

  /** ウェーブの敵を出す（出現位置はプレイヤーから見てアリーナの向こう側。encounter.ts の spawnPoint） */
  private spawnWave(index: number): void {
    for (const w of this.encounter.def.waves[index] ?? []) {
      const p = spawnPoint(w, this.player.body.x, this.player.body.z, this.arena.radius);
      this.spawnEnemy(w.type, p.x, p.z);
    }
  }

  /** 戦闘を始める（最初のウェーブがすぐ出る）。def を渡すと別の構成で始められる（開発・スクリーンショット用） */
  private startEncounter(def: EncounterDef = DEMO_ENCOUNTER): void {
    this.encounter = new Encounter(def);
    this.hud.setPlayerHp(this.player.health.hp, this.player.health.max);
    this.applyEncounterEvent(this.encounter.step(0, false));
  }

  private applyEncounterEvent(ev: EncounterEvent | null): void {
    if (!ev) return;
    if (ev.type === 'spawn') {
      this.spawnWave(ev.wave);
      this.hud.showBanner(ev.last && this.encounter.waveCount > 1 ? 'FINAL WAVE' : `WAVE ${ev.wave + 1}`);
    } else {
      const r = this.encounter.result();
      if (r) this.hud.showResult(r);
    }
  }

  /** プレイヤーの攻撃が敵に当たった。ヒットストップ・画面の揺れ・エフェクト・ダメージ数字を起こす */
  private onPlayerHit(ev: HitEvent, enemy: Enemy, result: DamageResult): void {
    const fb = hitFeedback(ev, result.killed);
    this.hitStop.trigger(fb.hitStop);
    this.cam.shake.trigger(fb.shakeAmp, fb.shakeSeconds);
    const y = HIT_FEEDBACK.impactHeight;
    this.hitFx.burst(ev.x, y, ev.z, ev.dirX, ev.dirZ, fb.power);
    this.damageNumbers.spawn(enemy.body.x, y + 0.5, enemy.body.z, result.dealt, fb.style);
    if (result.killed) {
      this.encounter.onKill();
      // 最後のウェーブの最後の 1 体: スローモーション
      if (this.encounter.onLastWave && !this.enemySims.some((e) => !e.dead)) this.hitStop.slow(FINISH_SLOW.scale, FINISH_SLOW.seconds);
    }
  }

  /** 敵の攻撃がプレイヤーに当たった。ヒットストップ・画面の揺れ・赤いフラッシュ・エフェクト・ダメージ数字・HP バー */
  private onEnemyHit(ev: HitEvent, result: DamageResult): void {
    const fb = hitFeedback(ev, result.killed);
    this.hitStop.trigger(fb.hitStop);
    this.cam.shake.trigger(fb.shakeAmp, fb.shakeSeconds);
    this.hitFx.burst(ev.x, HIT_FEEDBACK.playerImpactHeight, ev.z, ev.dirX, ev.dirZ, fb.power);
    this.damageNumbers.spawn(this.player.body.x, HIT_FEEDBACK.playerImpactHeight + 0.7, this.player.body.z, result.dealt, 'hurt');
    this.hud.flashHurt();
    this.hud.setPlayerHp(this.player.health.hp, this.player.health.max);
    this.encounter.onPlayerHit(result.dealt);
    if (result.killed) this.hitStop.slow(DEFEAT_SLOW.scale, DEFEAT_SLOW.seconds);
  }

  private step(dt: number): void {
    const intent = this.input.beginStep();
    if (this.encounter.ended) {
      // リザルトの間は操作を受け付けない（カメラだけ回せる）
      intent.moveX = 0;
      intent.moveY = 0;
      intent.attackPressed = false;
      intent.dodgePressed = false;
      intent.heavyPressed = false;
      intent.lockPressed = false;
      intent.lockSwitch = 0;
    }

    // ロックオン: 対象の選択・切替・解除。ロック中はカメラが対象の方を向き（ヨーの入力は使わない）、プレイヤーは対象を照準にする
    if (this.player.dead) this.lockOn.release();
    this.lockCands.length = 0;
    for (const e of this.enemySims) if (!e.dead) this.lockCands.push(e.body);
    this.lockOn.update({
      pressed: intent.lockPressed,
      switchDir: intent.lockSwitch,
      px: this.player.body.x,
      pz: this.player.body.z,
      camYaw: this.cam.yaw,
      cands: this.lockCands,
    });
    const locked = this.lockedEnemy();
    this.cam.rotate(locked ? 0 : intent.camYaw, intent.camPitch);
    this.cam.stepLock(dt, this.player.body.x, this.player.body.z, locked ? locked.body : null);
    this.player.setAim(locked ? locked.body : null);
    if (this.lockOn.locked !== this.lockIndicator) {
      this.lockIndicator = this.lockOn.locked;
      this.touch.setLockIndicator(this.lockIndicator);
    }

    this.player.step(dt, intent, this.cam.yaw);

    const alive = !this.player.dead;
    // 攻撃権: 同時に予備動作〜攻撃に入れる敵の数を制限する（残りは近くで構えて待つ）
    stepSwarm(this.enemySims, dt, this.player.body.x, this.player.body.z, alive, this.encounter.def.maxAttackers);
    // 先にプレイヤーの攻撃を解決する。同じフレームに当たり合うなら、プレイヤーが先に当てて敵の攻撃を中断する
    resolvePlayerAttack(this.player, this.enemySims, (ev, enemy, result) => this.onPlayerHit(ev, enemy, result));
    resolveEnemyAttacks(this.enemySims, this.player, (ev, _enemy, result) => this.onEnemyHit(ev, result));

    // 生きている敵は体を持つ（プレイヤーを押し出し、敵どうしは重ならない）。アリーナの外へは出ない
    for (let i = 0; i < this.enemySims.length; i++) {
      const a = this.enemySims[i]!;
      if (a.dead) continue;
      pushOutOfCircle(this.player.body, a.body);
      for (let j = i + 1; j < this.enemySims.length; j++) {
        const b = this.enemySims[j]!;
        if (!b.dead) separateCircles(a.body, b.body);
      }
    }
    for (const { enemy } of this.enemies) clampInsideArena(enemy.body, 0, 0, this.arena.radius);
    clampInsideArena(this.player.body, 0, 0, this.arena.radius);

    // 演出が終わった敵を取り除く
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const entry = this.enemies[i]!;
      if (!entry.enemy.removable) continue;
      this.scene.remove(entry.visual.root);
      entry.visual.dispose();
      this.enemies.splice(i, 1);
      this.enemySims.splice(i, 1);
    }
    // 戦闘の進行: 全滅でウェーブが進み、最後を倒すか倒されるかでリザルト
    let living = 0;
    for (const e of this.enemySims) if (!e.dead) living++;
    this.applyEncounterEvent(this.encounter.step(living, this.player.dead));
    this.input.endStep();
  }

  /** ロック中の敵（なければ null） */
  private lockedEnemy(): Enemy | null {
    const id = this.lockOn.targetId;
    if (id === null) return null;
    return this.enemySims.find((e) => e.id === id) ?? null;
  }

  /** 戦闘を最初からやり直す（敵を消してプレイヤーを初期状態へ、ウェーブを 1 波目から）。リザルトの「もう一度」もこれを呼ぶ。def で構成を替えられる（開発用） */
  restart(def: EncounterDef = DEMO_ENCOUNTER): void {
    for (const { visual } of this.enemies) {
      this.scene.remove(visual.root);
      visual.dispose();
    }
    this.enemies.length = 0;
    this.enemySims.length = 0;
    this.player.reset();
    this.lockOn.release();
    this.hitStop.reset();
    this.cam.shake.reset();
    this.hitFx.clear();
    this.swordTrail.clear();
    this.damageNumbers.clear();
    this.hud.hideResult();
    this.startEncounter(def);
  }

  private render(alpha: number, frameDt: number): void {
    if (this.host.contextLost) return;
    this.host.renderer.info.reset();
    const now = performance.now();
    const t = (now - this.startTime) / 1000;
    // アニメーションは sim の時間スケール（ヒットストップ）に従う
    // ヒットストップ: sim だけ止める。アニメは sim の時間スケールに従い、カメラ・エフェクト・UI は実時間で進む
    this.loop.stepper.timeScale = this.hitStop.update(frameDt);
    const animDt = frameDt * this.loop.stepper.timeScale;
    this.player.syncVisual(alpha, animDt, frameDt);
    for (const { enemy, visual } of this.enemies) visual.update(enemy, alpha, animDt, frameDt);
    // 剣筋: アニメ更新直後の刃の位置を記録する。時間はアニメの時間（ヒットストップで止まる）
    if (this.player.getBladePoints(_bladeBase, _bladeTip)) {
      this.swordTrail.update(animDt, this.player.trailActive, _bladeBase, _bladeTip);
    }
    this.player.getInterpolatedPosition(alpha, _pos);
    this.cam.update(_pos, frameDt);
    this.sky.follow(this.cam.camera);
    this.arena.animate(t);
    this.hitFx.update(frameDt);
    this.post.render();
    this.damageNumbers.update(this.cam.camera, frameDt, this.host.width, this.host.height);
    const locked = this.lockedEnemy();
    this.enemyBars.update(this.cam.camera, this.enemySims, this.host.width, this.host.height, locked ? locked.id : null);
    this.lockMarker.update(
      this.cam.camera,
      locked ? { id: locked.id, x: locked.body.x, y: locked.def.height * 0.6, z: locked.body.z } : null,
      frameDt,
      this.host.width,
      this.host.height,
    );
    this.hud.setTarget(locked ? { name: locked.def.name, hp: locked.health.hp, max: locked.health.max } : null);
    // 実フレーム間隔で解像度を調整する。段が変わるとレンダターゲットを作り直すので、描画の後で行う
    const nextRatio = this.adaptive.update(frameDt * 1000);
    if (nextRatio !== null) this.host.setMaxPixelRatio(nextRatio);
    this.hud.updateDebug(frameDt, now, () => {
      const info = this.host.renderer.info.render;
      const e0 = this.enemies[0]?.enemy;
      const foe = e0 ? `${e0.state} hp ${e0.health.hp}/${e0.health.max}` : '-';
      return `sim ${this.loop.stepper.frame}  state ${this.player.state}:${this.player.stateFrame}  enemy ${foe}  lock ${this.lockOn.targetId ?? '-'}\n` +
        `calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k  dpr ${this.host.pixelRatio.toFixed(2)}`;
    });
  }
}
