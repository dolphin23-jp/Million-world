import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addOutline, createToonMaterial, type ToonMaterial } from '../render/toon';

/**
 * プレースホルダーの盾（丸盾）。原点は盾の中心、面（敵へ向ける側）が +Z、上が +Y（sword.ts と同じく、差し替えるときも同じ原点・向きに正規化する）。
 * 動かない部品は頂点色で 1 つのメッシュにまとめる（描画呼び出しを減らす。enemy-visual.ts と同じ方針）。
 *
 * 左前腕のボーンに付ける（HeroVisual）。向きは肘の蝶番軸から決める（shieldMount）。
 */

export const SHIELD = {
  /** 盾の半径（m）。前腕（約 0.25m）より大きく、肘と手首の両方を覆う */
  radius: 0.25,
  /** 前腕の中点に対する盾の中心の位置（肘 → 手首を 0..1）。少し肘寄りに置くと、構えたとき盾が顔と胸の間に来る */
  along: 0.5,
  /** 前腕の軸から外側（盾の面の側）へ離す距離（m） */
  standoff: 0.085,
} as const;

export const SHIELD_COLORS = {
  body: 0x2c4aa8,
  trim: 0xffd36a,
  ring: 0xf4f1ea,
} as const;

interface Part {
  geo: THREE.BufferGeometry;
  color: number;
}

function paint(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map(({ geo, color }) => {
    const c = new THREE.Color(color);
    const n = geo.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  });
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) throw new Error('盾の部品の統合に失敗しました');
  return merged;
}

/** 盾のメッシュ。userData.material に素材を入れる（ガードの閃光・パリィの受付の光り方を変えるため） */
export function buildShield(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'shield';
  const R = SHIELD.radius;
  const C = SHIELD_COLORS;
  const mat = createToonMaterial({
    color: 0xffffff,
    vertexColors: true,
    steps: 2,
    shadowLevel: 0.55,
    rimColor: 0xcfe0ff,
    rimStrength: 0.55,
    rimPower: 2.2,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
  // 軸を Z にした円盤・輪（CylinderGeometry / TorusGeometry の既定の軸は Y / Z）
  const disc = new THREE.CylinderGeometry(R, R, 0.04, 30).rotateX(Math.PI / 2);
  const rim = new THREE.TorusGeometry(R, 0.024, 8, 36).translate(0, 0, 0.012);
  const ring = new THREE.TorusGeometry(R * 0.62, 0.013, 6, 30).translate(0, 0, 0.024);
  const boss = new THREE.SphereGeometry(0.075, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0, 0.02);
  const mesh = new THREE.Mesh(
    paint([
      { geo: disc, color: C.body },
      { geo: rim, color: C.trim },
      { geo: ring, color: C.ring },
      { geo: boss, color: C.trim },
    ]),
    mat,
  );
  mesh.castShadow = true;
  g.add(mesh);
  addOutline(mesh, { thickness: 0.02 });
  g.userData.material = mat as ToonMaterial;
  return g;
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * 左前腕のボーン（原点 = 肘、+Y = 手首の向き。ボーンのローカル空間は cm）に付けるときの位置と回転。
 * hingeF は肘の蝶番軸（前腕のローカル。rig.data.hinges.armL.f）、foreLength は肘から手首までの長さ（m）。
 *
 * 肘を曲げて前腕を立てたとき、曲がりの外側（上腕から遠い側）が前を向く。外側の向きは y × hinge（肘の曲げの向きの定義から）。
 * 盾の面（+Z）をそこへ、盾の上（+Y）を前腕の軸（手首の側）へ合わせる。
 */
export function shieldMount(hingeF: THREE.Vector3, foreLength: number): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  _z.crossVectors(_y, hingeF).normalize();
  _x.crossVectors(_y, _z).normalize();
  _m.makeBasis(_x, _y, _z);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(_m);
  const position = new THREE.Vector3(0, foreLength * SHIELD.along, 0).addScaledVector(_z, SHIELD.standoff).multiplyScalar(100);
  return { position, quaternion };
}
