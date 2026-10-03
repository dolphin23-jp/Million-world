import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { addOutline, createToonMaterial, type ToonParams } from '../render/toon';
import { addOutlineAttributes } from '../render/outline-attrs';

/**
 * キャラクター GLB（tools/build-character.mjs の出力）の読込。
 * - meshopt 圧縮を解凍
 * - マテリアルをトゥーンに差し替え（ベースカラーだけ使う。ADR-009）
 * - 輪郭線（inverted hull）を付ける
 * 呼び出しごとに独立したインスタンス（スケルトン・マテリアル）を返す。
 */

export interface CharacterAsset {
  root: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
  bones: Map<string, THREE.Bone>;
  meshes: THREE.SkinnedMesh[];
}

export interface LoadCharacterOptions {
  toon?: Partial<ToonParams>;
  outlineThickness?: number;
  castShadow?: boolean;
  /** 顔とみなすボーン名。これらのウェイト合計が頂点属性 aFace になる */
  faceBones?: string[];
  /** 顔の陰影の平坦化量（0..1） */
  faceFlat?: number;
  /** 顔の輪郭線の太さ倍率 */
  faceOutlineScale?: number;
}

/** 頭ボーンのスキンウェイト合計を aFace 属性として付ける（顔の平坦化・輪郭線の抑制に使う） */
function addFaceAttribute(mesh: THREE.SkinnedMesh, faceBones: string[]): void {
  const geo = mesh.geometry;
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  if (!si || !sw) return;
  const faceSet = new Set<number>();
  mesh.skeleton.bones.forEach((b, i) => {
    if (faceBones.includes(b.name)) faceSet.add(i);
  });
  const n = geo.getAttribute('position').count;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let f = 0;
    for (let k = 0; k < 4; k++) if (faceSet.has(si.getComponent(i, k))) f += sw.getComponent(i, k);
    out[i] = Math.min(1, f);
  }
  geo.setAttribute('aFace', new THREE.BufferAttribute(out, 1));
}

const bufferCache = new Map<string, Promise<ArrayBuffer>>();

function fetchBuffer(url: string): Promise<ArrayBuffer> {
  let p = bufferCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`キャラクターの取得に失敗: ${url} (${r.status})`);
      return r.arrayBuffer();
    });
    bufferCache.set(url, p);
  }
  return p;
}

let loader: GLTFLoader | null = null;
function getLoader(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

export async function loadCharacter(url: string, opts: LoadCharacterOptions = {}): Promise<CharacterAsset> {
  const buffer = await fetchBuffer(url);
  const gltf = await getLoader().parseAsync(buffer.slice(0), '');
  const root = new THREE.Group();
  root.name = 'character';
  root.add(gltf.scene);

  const meshes: THREE.SkinnedMesh[] = [];
  const bones = new Map<string, THREE.Bone>();
  gltf.scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
  });

  const faceBones = opts.faceBones ?? ['Head', 'head_end', 'headfront'];
  const faceFlat = opts.faceFlat ?? 0.8;
  for (const mesh of meshes) {
    const src = mesh.material as THREE.MeshStandardMaterial;
    const map = src.map ?? null;
    if (map) {
      map.colorSpace = THREE.SRGBColorSpace;
      // UV が細かい島に分かれた生成テクスチャは、斜めから見ると目鼻がぼやけるので異方性を高めに
      map.anisotropy = 16;
    }
    addFaceAttribute(mesh, faceBones);
    // 輪郭線が背骨の溝・裾で壊れないよう、押し出し用の法線と凹み量を作る
    addOutlineAttributes(mesh.geometry);
    mesh.material = createToonMaterial({
      color: 0xffffff,
      map,
      steps: 2,
      shadowLevel: 0.62,
      rimColor: 0xfff1e0,
      rimStrength: 0.22,
      rimPower: 3.5,
      faceFlat,
      ...opts.toon,
    });
    src.dispose();
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = false;
    // スキンの変形で境界球が外れるのでカリングしない
    mesh.frustumCulled = false;
    addOutline(mesh, { thickness: opts.outlineThickness ?? 0.028, faceScale: opts.faceOutlineScale ?? 0.35 });
  }

  const clips = new Map<string, THREE.AnimationClip>();
  for (const c of gltf.animations) clips.set(c.name, c);
  return { root, clips, bones, meshes };
}
