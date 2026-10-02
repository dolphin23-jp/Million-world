import * as THREE from 'three';
import { GameLoop } from '../core/loop';
import { InputAggregator, type InputIntent } from '../input/intent';
import { TouchInput } from '../input/touch';
import { KeyboardInput } from '../input/keyboard';
import { RendererHost } from '../render/renderer';
import { PostPipeline } from '../render/post';
import { SkyDome } from '../render/sky';
import { Arena } from '../world/arena';
import { clampInsideArena } from '../world/collision';
import { Player } from './player';
import { ThirdPersonCamera } from './camera';
import { Hud } from '../ui/hud';
import { onVisibility } from '../platform/safari';

/**
 * ゲーム全体を束ねる。sim（step）と render を分け、sim は InputIntent だけを入力に取る。
 */

const _pos = new THREE.Vector3();
const SUN_DIR = new THREE.Vector3(0.55, 0.75, 0.35).normalize();

export interface GameOptions {
  canvas: HTMLCanvasElement;
  debug?: boolean;
}

export class Game {
  readonly host: RendererHost;
  readonly scene = new THREE.Scene();
  readonly cam: ThirdPersonCamera;
  readonly post: PostPipeline;
  readonly sky: SkyDome;
  readonly arena: Arena;
  readonly player: Player;
  readonly input = new InputAggregator();
  readonly touch: TouchInput;
  readonly hud: Hud;
  readonly loop: GameLoop;
  private readonly startTime = performance.now();
  /** 開発用: 外部（スクリーンショットツール等）から入力を注入する */
  private injected: Partial<InputIntent> | null = null;

  constructor(opts: GameOptions) {
    this.host = new RendererHost({ canvas: opts.canvas, maxPixelRatio: 1.5 });
    this.cam = new ThirdPersonCamera(this.host.width / this.host.height);
    this.hud = new Hud();
    this.hud.setDebugVisible(opts.debug ?? true);

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

  start(): void {
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

  private step(dt: number): void {
    const intent = this.input.beginStep();
    this.cam.rotate(intent.camYaw, intent.camPitch);
    this.player.step(dt, intent, this.cam.yaw);
    clampInsideArena(this.player.body, 0, 0, this.arena.radius);
    this.input.endStep();
  }

  private render(alpha: number, frameDt: number): void {
    if (this.host.contextLost) return;
    this.host.renderer.info.reset();
    const now = performance.now();
    const t = (now - this.startTime) / 1000;
    this.player.syncVisual(alpha, t);
    this.player.getInterpolatedPosition(alpha, _pos);
    this.cam.update(_pos, frameDt);
    this.sky.follow(this.cam.camera);
    this.arena.animate(t);
    this.post.render();
    this.hud.updateDebug(frameDt, now, () => {
      const info = this.host.renderer.info.render;
      return `sim ${this.loop.stepper.frame}  state ${this.player.state}:${this.player.stateFrame}\n` +
        `calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k  dpr ${this.host.pixelRatio.toFixed(2)}`;
    });
  }
}
