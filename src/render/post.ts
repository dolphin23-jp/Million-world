import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * ポストプロセス（ADR-009、構成の見直しは ADR-011）。
 *
 *   シーン → sceneRT（MSAA・HalfFloat。HDR のまま）
 *          → ブルーム（半解像度のミップ鎖。画面サイズの描画はしない）
 *          → 最終 1 パス（ブルーム加算 + 色調 + ビネット + フラッシュ + sRGB 出力）→ 画面
 *
 * 以前は EffectComposer で「シーン → ブルーム加算（MSAA ターゲットへ書き戻し）→ グレード（もう 1 枚の MSAA
 * ターゲット）→ 出力」と、画面サイズ・HalfFloat・MSAA 4× のパスを 3 回通していた。iPad の fps が
 * 解像度に比例して落ちる原因はそこだったので、画面サイズのパスを「シーン」と「最終」の 2 回に減らした。
 * 見た目（ブルームの掛かり方・色調・ビネット）は旧構成と同じ式のまま。
 *
 * シーンを HDR（HalfFloat）のまま持つのは、発光物（クリスタルなど）が 1.0 を超える値でブルームを出すため。
 * RGBA8 にするとブルームが出なくなる（実測済み。ADR-011）。精度の切り替えは計測用に残してある。
 * 画面フラッシュやヒット時の彩度変化は最終パスの uniform を外から叩く（setFlash）。
 */

const BLOOM_MIPS = 5;
// UnrealBloomPass と同じ。ミップごとのブラー半径（バイリニア 2 点まとめの前の taps 数）と寄与の重み
const BLOOM_KERNELS = [6, 10, 14, 18, 22];
const BLOOM_FACTORS = [1.0, 0.8, 0.6, 0.4, 0.2];

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D( tDiffuse, vUv );
  float v = dot( texel.rgb, vec3( 0.2126729, 0.7151522, 0.0721750 ) );
  float a = smoothstep( uThreshold, uThreshold + 0.01, v );
  gl_FragColor = vec4( texel.rgb * a, 1.0 );
}
`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D colorTexture;
uniform vec2 invSize;
uniform vec2 direction;
uniform float centerWeight;
uniform float gaussianOffsets[KERNEL_PAIRS];
uniform float gaussianWeights[KERNEL_PAIRS];
varying vec2 vUv;
void main() {
  vec3 sum = texture2D( colorTexture, vUv ).rgb * centerWeight;
  for ( int i = 0; i < KERNEL_PAIRS; i ++ ) {
    vec2 o = direction * invSize * gaussianOffsets[ i ];
    sum += ( texture2D( colorTexture, vUv + o ).rgb + texture2D( colorTexture, vUv - o ).rgb ) * gaussianWeights[ i ];
  }
  gl_FragColor = vec4( sum, 1.0 );
}
`;

const FINAL_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
#ifdef USE_BLOOM
uniform sampler2D tBloom0;
uniform sampler2D tBloom1;
uniform sampler2D tBloom2;
uniform sampler2D tBloom3;
uniform sampler2D tBloom4;
uniform float uBloomW[5];
#endif
uniform float uVignette;
uniform float uSaturation;
uniform float uContrast;
uniform vec4 uFlash;
uniform vec3 uLift;
varying vec2 vUv;
void main() {
  vec3 col = texture2D( tDiffuse, vUv ).rgb;
#ifdef USE_BLOOM
  col += uBloomW[0] * texture2D( tBloom0, vUv ).rgb
       + uBloomW[1] * texture2D( tBloom1, vUv ).rgb
       + uBloomW[2] * texture2D( tBloom2, vUv ).rgb
       + uBloomW[3] * texture2D( tBloom3, vUv ).rgb
       + uBloomW[4] * texture2D( tBloom4, vUv ).rgb;
#endif
  // リフト（影の色味）
  col = col + uLift * ( 1.0 - col );
  // コントラスト
  col = ( col - 0.5 ) * uContrast + 0.5;
  // 彩度
  float l = dot( col, vec3( 0.299, 0.587, 0.114 ) );
  col = mix( vec3( l ), col, uSaturation );
  // ビネット
  vec2 p = vUv - 0.5;
  float v = 1.0 - smoothstep( 0.35, 0.95, dot( p, p ) * 2.2 ) * uVignette;
  col *= v;
  // フラッシュ
  col = mix( col, uFlash.rgb, clamp( uFlash.a, 0.0, 1.0 ) );
  gl_FragColor = vec4( col, 1.0 );
  #include <colorspace_fragment>
}
`;

export interface PostOptions {
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
  /** MSAA サンプル数（WebGL2）。0 で無効 */
  samples?: number;
  /** ブルームの最初のミップの解像度（シーンに対する比。既定 0.5） */
  bloomScale?: number;
}

/**
 * シーン用ターゲットの精度。
 *   half      HalfFloat（既定。HDR・旧構成と同じ見た目）
 *   r11g11b10 R11F_G11F_B10F（HDR で 4 byte/px。EXT_color_buffer_float が要る。計測用）
 *   rgba8     RGBA8 + sRGB 格納（LDR。1.0 超えが潰れてブルームが弱くなる。計測用）
 */
export type SceneFormat = 'half' | 'r11g11b10' | 'rgba8';

export interface SceneTargetOptions {
  samples?: number;
  format?: SceneFormat;
}

function makeBlurMaterial(kernelRadius: number): THREE.ShaderMaterial {
  // UnrealBloomPass と同じガウス係数。隣り合う 2 tap を 1 回のバイリニア取得にまとめる
  const sigma = kernelRadius / 3;
  const coef: number[] = [];
  for (let i = 0; i < kernelRadius; i++) coef.push((0.39894 * Math.exp((-0.5 * i * i) / (sigma * sigma))) / sigma);
  const offsets: number[] = [];
  const weights: number[] = [];
  for (let i = 1; i < kernelRadius; i += 2) {
    const wa = coef[i] ?? 0;
    const wb = i + 1 < kernelRadius ? (coef[i + 1] ?? 0) : 0;
    const w = wa + wb;
    offsets.push((i * wa + (i + 1) * wb) / w);
    weights.push(w);
  }
  return new THREE.ShaderMaterial({
    defines: { KERNEL_PAIRS: offsets.length },
    uniforms: {
      colorTexture: { value: null as THREE.Texture | null },
      invSize: { value: new THREE.Vector2(1, 1) },
      direction: { value: new THREE.Vector2(1, 0) },
      centerWeight: { value: coef[0] ?? 0 },
      gaussianOffsets: { value: offsets },
      gaussianWeights: { value: weights },
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: BLUR_FRAG,
    depthTest: false,
    depthWrite: false,
  });
}

export class PostPipeline {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private camera: THREE.Camera;
  private readonly quad = new FullScreenQuad();

  private samples: number;
  private format: SceneFormat = 'half';
  private sceneRT: THREE.WebGLRenderTarget;
  private width = 1;
  private height = 1;

  private strength: number;
  private radius: number;
  private threshold: number;
  private bloomScale: number;
  private _bloomEnabled = true;
  private readonly bright: THREE.WebGLRenderTarget;
  private readonly blurH: THREE.WebGLRenderTarget[] = [];
  private readonly blurV: THREE.WebGLRenderTarget[] = [];
  private readonly brightMat: THREE.ShaderMaterial;
  private readonly blurMats: THREE.ShaderMaterial[];
  private readonly finalMat: THREE.ShaderMaterial;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: PostOptions = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.samples = Math.min(opts.samples ?? 4, renderer.capabilities.maxSamples);
    this.strength = opts.bloomStrength ?? 0.35;
    this.radius = opts.bloomRadius ?? 0.4;
    this.threshold = opts.bloomThreshold ?? 0.85;
    this.bloomScale = opts.bloomScale ?? 0.5;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.width = size.x;
    this.height = size.y;
    this.sceneRT = this.makeSceneTarget();

    // ブルーム用ターゲット（深度なし・非 MSAA。HalfFloat は小さいので許容）
    const bloomRT = (name: string): THREE.WebGLRenderTarget => {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
      rt.texture.name = name;
      rt.texture.generateMipmaps = false;
      return rt;
    };
    this.bright = bloomRT('post.bright');
    for (let i = 0; i < BLOOM_MIPS; i++) {
      this.blurH.push(bloomRT(`post.h${i}`));
      this.blurV.push(bloomRT(`post.v${i}`));
    }

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uThreshold: { value: this.threshold } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BRIGHT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMats = BLOOM_KERNELS.map((k) => makeBlurMaterial(k));

    this.finalMat = new THREE.ShaderMaterial({
      defines: { USE_BLOOM: '' },
      uniforms: {
        tDiffuse: { value: this.sceneRT.texture },
        tBloom0: { value: this.blurV[0]!.texture },
        tBloom1: { value: this.blurV[1]!.texture },
        tBloom2: { value: this.blurV[2]!.texture },
        tBloom3: { value: this.blurV[3]!.texture },
        tBloom4: { value: this.blurV[4]!.texture },
        uBloomW: { value: [0, 0, 0, 0, 0] },
        uVignette: { value: 0.35 },
        uSaturation: { value: 1.08 },
        uContrast: { value: 1.04 },
        uFlash: { value: new THREE.Vector4(1, 1, 1, 0) }, // rgb, 強度
        uLift: { value: new THREE.Vector3(0.0, 0.0, 0.02) }, // 影にわずかな青
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: FINAL_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.updateBloomWeights();
    this.layoutBloom();
  }

  private makeSceneTarget(): THREE.WebGLRenderTarget {
    const f = this.format;
    return new THREE.WebGLRenderTarget(this.width, this.height, {
      samples: this.samples,
      type: f === 'half' ? THREE.HalfFloatType : f === 'r11g11b10' ? THREE.UnsignedInt101111Type : THREE.UnsignedByteType,
      format: f === 'r11g11b10' ? THREE.RGBFormat : THREE.RGBAFormat,
      // RGBA8 は sRGB 格納にする: シェーダは線形で書き、書き込み時にハードウェアが sRGB へ変換、
      // 読むときに線形へ戻る。暗部の段差を出さずに 8bit で済む
      colorSpace: f === 'rgba8' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      // 深度は読まない。解決（resolve）のコピーを省く
      resolveDepthBuffer: false,
    });
  }

  /** シーン用ターゲットのサンプル数・精度を変える（計測用）。通常は触らない */
  setSceneTarget(opts: SceneTargetOptions): void {
    if (opts.samples !== undefined) this.samples = Math.min(opts.samples, this.renderer.capabilities.maxSamples);
    if (opts.format !== undefined) this.format = opts.format;
    this.sceneRT.dispose();
    this.sceneRT = this.makeSceneTarget();
    this.finalMat.uniforms.tDiffuse!.value = this.sceneRT.texture;
  }

  get sceneSamples(): number {
    return this.samples;
  }

  get sceneFormat(): SceneFormat {
    return this.format;
  }

  get bloomEnabled(): boolean {
    return this._bloomEnabled;
  }
  set bloomEnabled(v: boolean) {
    if (v === this._bloomEnabled) return;
    this._bloomEnabled = v;
    if (v) this.finalMat.defines.USE_BLOOM = '';
    else delete this.finalMat.defines.USE_BLOOM;
    this.finalMat.needsUpdate = true;
  }

  /** ブルームの最初のミップの解像度比を変える（既定 0.5。計測用） */
  setBloomScale(scale: number): void {
    this.bloomScale = scale;
    this.layoutBloom();
  }

  setBloom(strength: number, radius: number, threshold: number): void {
    this.strength = strength;
    this.radius = radius;
    this.threshold = threshold;
    this.updateBloomWeights();
  }

  private updateBloomWeights(): void {
    // UnrealBloomPass の合成式: 3 * strength * Σ lerp(factor, 1.2 - factor, radius) * mip
    const w = this.finalMat.uniforms.uBloomW!.value as number[];
    for (let i = 0; i < BLOOM_MIPS; i++) {
      const f = BLOOM_FACTORS[i]!;
      w[i] = 3.0 * this.strength * (f + (1.2 - f - f) * this.radius);
    }
    this.brightMat.uniforms.uThreshold!.value = this.threshold;
  }

  /** ブルームのミップ鎖を現在のシーンサイズに合わせる */
  private layoutBloom(): void {
    let w = Math.max(1, Math.round(this.width * this.bloomScale));
    let h = Math.max(1, Math.round(this.height * this.bloomScale));
    this.bright.setSize(w, h);
    for (let i = 0; i < BLOOM_MIPS; i++) {
      this.blurH[i]!.setSize(w, h);
      this.blurV[i]!.setSize(w, h);
      (this.blurMats[i]!.uniforms.invSize!.value as THREE.Vector2).set(1 / w, 1 / h);
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
    }
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  /** CSS px サイズと pixelRatio を受け取る */
  setSize(width: number, height: number, pixelRatio: number): void {
    const w = Math.max(1, Math.floor(width * pixelRatio));
    const h = Math.max(1, Math.floor(height * pixelRatio));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.sceneRT.setSize(w, h);
    this.layoutBloom();
  }

  /** 画面フラッシュ（rgb と強度 0..1）。減衰は呼び出し側で */
  setFlash(r: number, g: number, b: number, a: number): void {
    (this.finalMat.uniforms.uFlash!.value as THREE.Vector4).set(r, g, b, a);
  }

  render(): void {
    const r = this.renderer;

    // 1. シーン（MSAA はここだけ）
    r.setRenderTarget(this.sceneRT);
    r.render(this.scene, this.camera);

    // 2. ブルーム: 明部抽出 → 半解像度から順に縮めながら縦横ブラー
    if (this._bloomEnabled) {
      this.pass(this.brightMat, 'tDiffuse', this.sceneRT.texture, this.bright);
      let input = this.bright;
      for (let i = 0; i < BLOOM_MIPS; i++) {
        const m = this.blurMats[i]!;
        (m.uniforms.direction!.value as THREE.Vector2).set(1, 0);
        this.pass(m, 'colorTexture', input.texture, this.blurH[i]!);
        (m.uniforms.direction!.value as THREE.Vector2).set(0, 1);
        this.pass(m, 'colorTexture', this.blurH[i]!.texture, this.blurV[i]!);
        input = this.blurV[i]!;
      }
    }

    // 3. 最終: ブルーム加算 + 色調 + 出力（画面へ）
    r.setRenderTarget(null);
    this.quad.material = this.finalMat;
    this.quad.render(r);
  }

  private pass(mat: THREE.ShaderMaterial, uniform: string, src: THREE.Texture, dst: THREE.WebGLRenderTarget): void {
    mat.uniforms[uniform]!.value = src;
    this.renderer.setRenderTarget(dst);
    this.quad.material = mat;
    this.quad.render(this.renderer);
  }

  dispose(): void {
    this.sceneRT.dispose();
    this.bright.dispose();
    for (const rt of [...this.blurH, ...this.blurV]) rt.dispose();
    this.brightMat.dispose();
    this.finalMat.dispose();
    for (const m of this.blurMats) m.dispose();
    this.quad.dispose();
  }
}
