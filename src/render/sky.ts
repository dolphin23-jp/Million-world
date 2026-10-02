import * as THREE from 'three';

/**
 * アニメ調の空: 地平線→天頂のグラデーション + 太陽のぼかし + 薄い雲帯。
 * カメラに追従する大きな球の内側に描く。フォグの色は地平線色に合わせる。
 */

export interface SkyColors {
  zenith: THREE.ColorRepresentation;
  horizon: THREE.ColorRepresentation;
  ground: THREE.ColorRepresentation;
  sun: THREE.ColorRepresentation;
}

export const DEFAULT_SKY: SkyColors = {
  zenith: 0x2f55c7,
  horizon: 0xbfd9ff,
  ground: 0x4a4f78,
  sun: 0xfff1c4,
};

const vert = /* glsl */ `
varying vec3 vWorldDir;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWorldDir = normalize( wp.xyz - cameraPosition );
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  // 常に最遠に描く
  gl_Position.z = gl_Position.w * 0.999999;
}
`;

const frag = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSun;
uniform vec3 uSunDir;
varying vec3 vWorldDir;

// 安価なハッシュノイズ（雲帯用）
float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float noise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1, 0 ) ), f.x ),
              mix( hash( i + vec2( 0, 1 ) ), hash( i + vec2( 1, 1 ) ), f.x ), f.y );
}

void main() {
  vec3 d = normalize( vWorldDir );
  float h = d.y;
  vec3 col;
  if ( h >= 0.0 ) {
    float t = pow( clamp( h, 0.0, 1.0 ), 0.55 );
    col = mix( uHorizon, uZenith, t );
  } else {
    float t = pow( clamp( -h, 0.0, 1.0 ), 0.5 );
    col = mix( uHorizon, uGround, t );
  }
  // 太陽: 中心の円 + 大きなハロー
  float sd = max( dot( d, normalize( uSunDir ) ), 0.0 );
  float disc = smoothstep( 0.9985, 0.9995, sd );
  float halo = pow( sd, 24.0 ) * 0.35;
  col += uSun * ( disc + halo );
  // 雲帯: 地平線上空に薄く、段階的な明暗（アニメの平たい雲）
  if ( h > 0.02 && h < 0.45 ) {
    vec2 uv = vec2( atan( d.z, d.x ) * 2.2, h * 9.0 );
    float n = noise( uv * 1.8 ) * 0.6 + noise( uv * 4.1 ) * 0.4;
    float band = smoothstep( 0.02, 0.1, h ) * ( 1.0 - smoothstep( 0.3, 0.45, h ) );
    float cloud = step( 0.62, n ) * band;
    float shade = step( 0.72, n );
    col = mix( col, mix( vec3( 0.86, 0.9, 1.0 ), vec3( 1.0 ), shade ), cloud * 0.85 );
  }
  gl_FragColor = vec4( col, 1.0 );
}
`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(colors: SkyColors = DEFAULT_SKY, sunDir = new THREE.Vector3(0.5, 0.6, 0.3)) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uZenith: { value: new THREE.Color(colors.zenith) },
        uHorizon: { value: new THREE.Color(colors.horizon) },
        uGround: { value: new THREE.Color(colors.ground) },
        uSun: { value: new THREE.Color(colors.sun) },
        uSunDir: { value: sunDir.clone().normalize() },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), this.material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  /** カメラに追従させる（毎フレーム） */
  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }
}
