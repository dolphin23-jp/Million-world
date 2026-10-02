import * as THREE from 'three';

/**
 * レンダラ初期化はここ 1 箇所に閉じる（ADR-002: 将来 WebGPU へ差し替え可能にする）。
 * iPad の DPR は 2 だが、ポストプロセス込みで描くので内部解像度は renderScale で抑える。
 */

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  /** devicePixelRatio に掛ける係数の上限。実機で動的に調整する */
  maxPixelRatio?: number;
}

export class RendererHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private maxPixelRatio: number;
  /** 画面サイズが変わったときに呼ばれる（ポストプロセスのリサイズなど） */
  onResize: ((width: number, height: number, pixelRatio: number) => void) | null = null;
  /** コンテキストが復帰したときに呼ばれる。マテリアルやレンダターゲットを作り直す側が登録する */
  onContextRestored: (() => void) | null = null;
  contextLost = false;

  constructor(opts: RendererOptions) {
    this.canvas = opts.canvas;
    this.maxPixelRatio = opts.maxPixelRatio ?? 1.5;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false, // ポストプロセス側の MSAA レンダターゲットで AA する
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // 統計はフレーム単位で手動リセット（EffectComposer が複数回 render するため）
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // トゥーンは色をそのまま出す
    this.renderer.setClearColor(0x0b0d1a, 1);

    this.canvas.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault(); // 復帰を許可する
        this.contextLost = true;
        console.warn('[renderer] WebGL context lost');
      },
      false,
    );
    this.canvas.addEventListener(
      'webglcontextrestored',
      () => {
        this.contextLost = false;
        console.warn('[renderer] WebGL context restored');
        this.applySize();
        this.onContextRestored?.();
      },
      false,
    );

    window.addEventListener('resize', () => this.applySize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.applySize(), 50));
    this.applySize();
  }

  get pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
  }

  setMaxPixelRatio(v: number): void {
    this.maxPixelRatio = v;
    this.applySize();
  }

  get width(): number {
    return window.innerWidth;
  }
  get height(): number {
    return window.innerHeight;
  }

  applySize(): void {
    const w = this.width;
    const h = this.height;
    const pr = this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.onResize?.(w, h, pr);
  }
}
