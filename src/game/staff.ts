import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addOutline, createToonMaterial, type ToonMaterial } from '../render/toon';

/**
 * プレースホルダーの杖（ADR-048。片手で持つ魔法の媒体）。原点は右手の握り（柄の中ほど）、頭（宝珠）が +Y（sword.ts と同じ約束。剣の「刃」の向き = 杖の頭の向き）。
 * 柄は石突き（−Y）へ 0.62m、頭は +Y へ約 1.3m まで。宝珠は詠唱のあいだ光る（HeroVisual が userData.steel の発光を動かす）。
 *
 * 描画呼び出しを減らすため、宝珠（光る）と、柄・金具・輪・爪（頂点色）の 2 つのメッシュにまとめる。
 */

export const STAFF = {
  /** 柄の下端（石突き）と、宝珠の中心の y（m）。詠唱のとき杖の頭は宝珠の位置（HeroVisual の getBladePoints が使う帯の先） */
  buttY: -0.64,
  orbY: 1.14,
  headY: 1.3,
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
  if (!merged) throw new Error('杖の部品の統合に失敗しました');
  return merged;
}

/** 杖のメッシュ。userData.steel に宝珠の素材（詠唱の光り方を変える）を入れる */
export function buildStaff(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'staff';
  const orbMat = createToonMaterial({
    color: 0xbff0ff,
    steps: 2,
    shadowLevel: 0.7,
    rimColor: 0xffffff,
    rimStrength: 1,
    rimPower: 1.6,
    emissive: 0x3d86c7,
    emissiveIntensity: 0.9,
  });
  const fitting = createToonMaterial({ color: 0xffffff, vertexColors: true, steps: 2, shadowLevel: 0.55, rimStrength: 0.4 });

  const wood = 0x7a5232;
  const gold = 0xffd36a;
  const wrap = 0x1d2a66;
  const ring = new THREE.TorusGeometry(0.115, 0.017, 8, 20).translate(0, STAFF.orbY, 0);
  const prongL = new THREE.ConeGeometry(0.026, 0.22, 7).rotateZ(0.5).translate(0.1, STAFF.orbY - 0.17, 0);
  const prongR = new THREE.ConeGeometry(0.026, 0.22, 7).rotateZ(-0.5).translate(-0.1, STAFF.orbY - 0.17, 0);
  const fittings = new THREE.Mesh(
    paint([
      // 柄（細く長い）と、握りの巻き革
      { geo: new THREE.CylinderGeometry(0.021, 0.025, 1.62, 9).translate(0, 0.17, 0), color: wood },
      { geo: new THREE.CylinderGeometry(0.029, 0.029, 0.26, 9).translate(0, 0, 0), color: wrap },
      // 金の帯と石突き
      { geo: new THREE.CylinderGeometry(0.033, 0.033, 0.03, 9).translate(0, -0.2, 0), color: gold },
      { geo: new THREE.CylinderGeometry(0.033, 0.033, 0.03, 9).translate(0, 0.24, 0), color: gold },
      { geo: new THREE.CylinderGeometry(0.034, 0.034, 0.04, 9).translate(0, 0.9, 0), color: gold },
      { geo: new THREE.SphereGeometry(0.036, 8, 6).translate(0, STAFF.buttY, 0), color: gold },
      // 頭: 宝珠を抱く金の輪と、下から支える 2 本の爪
      { geo: ring, color: gold },
      { geo: prongL, color: gold },
      { geo: prongR, color: gold },
    ]),
    fitting,
  );
  fittings.castShadow = true;
  g.add(fittings);
  addOutline(fittings, { thickness: 0.018 });

  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.078, 14, 10), orbMat);
  orb.position.y = STAFF.orbY;
  g.add(orb);
  addOutline(orb, { thickness: 0.018 });

  g.userData.steel = orbMat as ToonMaterial;
  return g;
}
