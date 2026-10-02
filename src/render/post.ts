import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * ポストプロセス（ADR-009）: MSAA レンダターゲット → ブルーム（控えめ）→ 色調/ビネット → 出力。
 * 画面フラッシュやヒット時の彩度変化は GradePass の uniform を外から叩く。
 */

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.35 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.04 },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) }, // rgb, 強度
    uLift: { value: new THREE.Vector3(0.0, 0.0, 0.02) }, // 影にわずかな青
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uVignette;
uniform float uSaturation;
uniform float uContrast;
uniform vec4 uFlash;
uniform vec3 uLift;
varying vec2 vUv;
void main() {
  vec4 c = texture2D( tDiffuse, vUv );
  vec3 col = c.rgb;
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
  gl_FragColor = vec4( col, c.a );
}
`,
};

export interface PostOptions {
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
  /** MSAA サンプル数（WebGL2）。0 で無効 */
  samples?: number;
}

export class PostPipeline {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly grade: ShaderPass;
  private readonly renderPass: RenderPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    opts: PostOptions = {},
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      samples: opts.samples ?? 4,
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      opts.bloomStrength ?? 0.35,
      opts.bloomRadius ?? 0.4,
      opts.bloomThreshold ?? 0.85,
    );
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setCamera(camera: THREE.Camera): void {
    this.renderPass.camera = camera;
  }

  /** CSS px サイズと pixelRatio を受け取る */
  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  /** 画面フラッシュ（rgb と強度 0..1）。減衰は呼び出し側で */
  setFlash(r: number, g: number, b: number, a: number): void {
    (this.grade.uniforms.uFlash!.value as THREE.Vector4).set(r, g, b, a);
  }

  render(): void {
    this.composer.render();
  }
}
