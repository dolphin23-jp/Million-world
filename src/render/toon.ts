import * as THREE from 'three';

/**
 * トゥーン描画（ADR-009）。
 * - 全オブジェクトは createToonMaterial 経由でマテリアルを作る（将来 WebGPU 版に差し替えるため）
 * - 階調は gradientMap（2〜3 段）。影の色味は半球光（HemisphereLight）の地面色で付ける
 * - リムライトは onBeforeCompile で注入
 * - 輪郭線は inverted hull（法線方向に押し出した裏面）。スキニングにも対応するチャンクを含む
 */

export interface ToonParams {
  color: THREE.ColorRepresentation;
  /** 階調数（2 または 3）。既定 3 */
  steps?: 2 | 3;
  /** 影側の明るさ（0..1）。gradientMap の最暗段 */
  shadowLevel?: number;
  rimColor?: THREE.ColorRepresentation;
  rimStrength?: number; // 0 で無効
  rimPower?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  map?: THREE.Texture | null;
  /** ジオメトリの頂点色（color 属性）を色に掛ける。色違いの部品を 1 つのメッシュにまとめて描画呼び出しを減らすときに使う */
  vertexColors?: boolean;
  transparent?: boolean;
  opacity?: number;
  /**
   * 顔の平坦化（キャラ用）。ジオメトリの頂点属性 aFace（0..1、頭ボーンのウェイト）が 1 の頂点は、
   * 陰影を抑えてテクスチャ色をそのまま出す。アニメの顔は陰影を付けないのが定石で、
   * 2 階調の影が顔を横切ると目鼻が消えるため
   */
  faceFlat?: number;
}

const gradientCache = new Map<string, THREE.DataTexture>();

/** 2〜3 段の階調テクスチャ。NearestFilter で段を硬くする */
export function getGradientMap(steps: 2 | 3, shadowLevel: number): THREE.DataTexture {
  const key = `${steps}:${shadowLevel.toFixed(3)}`;
  const cached = gradientCache.get(key);
  if (cached) return cached;
  const levels =
    steps === 2 ? [shadowLevel, 1.0] : [shadowLevel, shadowLevel + (1 - shadowLevel) * 0.55, 1.0];
  const data = new Uint8Array(levels.length * 4);
  levels.forEach((l, i) => {
    const v = Math.round(l * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  });
  const tex = new THREE.DataTexture(data, levels.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradientCache.set(key, tex);
  return tex;
}

export type ToonMaterial = THREE.MeshToonMaterial & {
  userData: { rim: { color: THREE.Color; strength: number; power: number } };
};

export function createToonMaterial(p: ToonParams): ToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color: p.color,
    gradientMap: getGradientMap(p.steps ?? 3, p.shadowLevel ?? 0.45),
    emissive: p.emissive ?? 0x000000,
    emissiveIntensity: p.emissiveIntensity ?? 1,
    map: p.map ?? null,
    vertexColors: p.vertexColors ?? false,
    transparent: p.transparent ?? false,
    opacity: p.opacity ?? 1,
  }) as ToonMaterial;

  const rim = {
    color: new THREE.Color(p.rimColor ?? 0xffffff),
    strength: p.rimStrength ?? 0.35,
    power: p.rimPower ?? 3.0,
  };
  mat.userData.rim = rim;

  const faceFlat = p.faceFlat ?? 0;
  const useFace = faceFlat > 0;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: rim.color };
    shader.uniforms.uRimStrength = { value: rim.strength };
    shader.uniforms.uRimPower = { value: rim.power };
    shader.uniforms.uFaceFlat = { value: faceFlat };
    if (useFace) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute float aFace;
varying float vFace;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vFace = aFace;`);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uRimPower;
uniform float uFaceFlat;
${useFace ? 'varying float vFace;' : ''}`,
      )
      .replace(
        '#include <opaque_fragment>',
        `// --- rim light（画面端の縁取り。光源方向に関係なく輪郭を明るくする） ---
{
  vec3 vdir = normalize( vViewPosition );
  float fres = pow( 1.0 - saturate( dot( normal, vdir ) ), uRimPower );
  outgoingLight += uRimColor * fres * uRimStrength;
}
${useFace ? `// --- 顔の平坦化: 頭の頂点はテクスチャ色をそのまま（わずかに明るく）出す ---
outgoingLight = mix( outgoingLight, diffuseColor.rgb * 1.02, clamp( vFace, 0.0, 1.0 ) * uFaceFlat );` : ''}
#include <opaque_fragment>`,
      );
  };
  // 注入内容が同じマテリアル同士はプログラムを共有してよい。顔の有無で分ける
  mat.customProgramCacheKey = () => (useFace ? 'toon-rim-face-v1' : 'toon-rim-v1');
  return mat;
}

// ---------------- 輪郭線 ----------------

export interface OutlineParams {
  color?: THREE.ColorRepresentation;
  /** 太さ（ワールド単位、距離 1m のとき）。遠くでも細くなりすぎないよう距離で補正する */
  thickness?: number;
  /** 不透明度 */
  opacity?: number;
  /** 視線方向に奥へ送る量（m）。表面を突き破る輪郭の線を隠す。既定 0.006 */
  depthPush?: number;
  /** 頂点属性 aFace=1 の頂点での太さ倍率（顔の目鼻に黒い塊が出るのを防ぐ）。既定 1 */
  faceScale?: number;
}

const outlineVertex = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
#include <morphtarget_pars_vertex>
uniform float uThickness;
uniform float uFaceScale;
uniform float uDepthPush;
attribute float aFace;
// 凹んだ溝（背骨・脇・服のしわ）で押し出しが表面を突き破らないよう、頂点ごとに輪郭線を削る（0 = 満額）。
// 属性が無いメッシュでは 0 が読まれるので満額のまま
attribute float aOutlineCut;
#ifdef USE_ONORMAL
attribute vec3 aONormal; // 押し出し専用に平滑化した法線（src/render/outline-attrs.ts）
#endif
void main() {
  #include <beginnormal_vertex>
  #ifdef USE_ONORMAL
  objectNormal = aONormal;
  #endif
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
  vec3 viewNormal = normalize( normalMatrix * objectNormal );
  // 画面上でほぼ一定の太さになるよう、カメラ距離に比例して押し出す
  float dist = max( -mvPosition.z, 0.5 );
  mvPosition.xyz += viewNormal * uThickness * mix( 1.0, uFaceScale, clamp( aFace, 0.0, 1.0 ) ) * ( 1.0 - clamp( aOutlineCut, 0.0, 1.0 ) ) * dist * 0.22;
  // 輪郭線を視線方向に少し奥へ送る（画面上の位置は変えない）。細かい溝・裾で押し出した裏面が
  // 表面を数 mm 突き破って暗いギザギザになるのを、奥行きテストで隠す。外周の輪郭は手前に何もないので影響しない
  mvPosition.xyz *= 1.0 + uDepthPush / dist;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const outlineFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  gl_FragColor = vec4( uColor, uOpacity );
}
`;

export function createOutlineMaterial(p: OutlineParams = {}, smoothNormals = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: smoothNormals ? { USE_ONORMAL: '' } : {},
    vertexShader: outlineVertex,
    fragmentShader: outlineFragment,
    uniforms: {
      uColor: { value: new THREE.Color(p.color ?? 0x14121f) },
      uThickness: { value: p.thickness ?? 0.03 },
      uOpacity: { value: p.opacity ?? 1 },
      uFaceScale: { value: p.faceScale ?? 1 },
      uDepthPush: { value: p.depthPush ?? 0.006 },
    },
    side: THREE.BackSide,
    transparent: (p.opacity ?? 1) < 1,
    depthWrite: true,
  });
}

/**
 * mesh と同じジオメトリで裏面だけ描く輪郭線メッシュを子として追加する。
 * SkinnedMesh の場合はスケルトンを共有する。
 */
export function addOutline(mesh: THREE.Mesh, p: OutlineParams = {}): THREE.Mesh {
  const mat = createOutlineMaterial(p, Boolean(mesh.geometry.getAttribute('aONormal')));
  let outline: THREE.Mesh;
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
    const sm = mesh as THREE.SkinnedMesh;
    const o = new THREE.SkinnedMesh(sm.geometry, mat);
    o.bind(sm.skeleton, sm.bindMatrix);
    outline = o;
  } else {
    outline = new THREE.Mesh(mesh.geometry, mat);
  }
  outline.name = `${mesh.name || 'mesh'}__outline`;
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.frustumCulled = mesh.frustumCulled;
  outline.renderOrder = mesh.renderOrder;
  mesh.add(outline);
  return outline;
}

/** 階層以下の全 Mesh に輪郭線を付ける */
export function addOutlineRecursive(root: THREE.Object3D, p: OutlineParams = {}): void {
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.name.endsWith('__outline')) targets.push(m);
  });
  for (const m of targets) addOutline(m, p);
}
