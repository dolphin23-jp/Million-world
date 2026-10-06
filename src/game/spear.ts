import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addOutline, createToonMaterial, type ToonMaterial } from '../render/toon';

/**
 * プレースホルダーの槍（ADR-049。両手持ち）。原点は右手の握り（柄の中ほどより少し石突き寄り）、穂先が +Y、穂先の面の法線が +Z（sword.ts と同じ約束）。
 * 柄は石突き（−Y）へ 0.58m、穂先の先端は +Y へ 1.85m（全長 2.43m）。左手は右手より 0.38m 石突き寄り（TwoHand.offset。src/character/data/spear.ts の SP_TWO_HAND）を握る
 * （右手が前、左手が後ろの構え）。
 *
 * 描画呼び出しを減らすため、穂先（溜めのとき光らせる）と、柄・金具・房（頂点色）の 2 つのメッシュにまとめる。
 */

export const SPEAR = {
  /** 柄の下端（石突き）・穂先の根元（金の輪の上）・先端の y（m）。剣筋の帯は柄の中ほどから先端を結ぶ（hero-visual の BLADE_RANGE） */
  buttY: -0.58,
  headBaseY: 1.5,
  tipY: 1.85,
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
  if (!merged) throw new Error('槍の部品の統合に失敗しました');
  return merged;
}

/** 槍のメッシュ。userData.steel に穂先の素材（溜めの光り方を変える）を入れる */
export function buildSpear(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'spear';
  const steel = createToonMaterial({
    color: 0xe4ecf8,
    steps: 2,
    shadowLevel: 0.55,
    rimColor: 0xffffff,
    rimStrength: 0.9,
    rimPower: 2.0,
    emissive: 0x2b3a55,
    emissiveIntensity: 0.6,
  });
  const fitting = createToonMaterial({ color: 0xffffff, vertexColors: true, steps: 2, shadowLevel: 0.55, rimStrength: 0.4 });

  // 穂先: 笹の葉の形（根元で細く、根元から少し先で最も広く、先端へ尖る）。幅 0.11m・厚み 0.022m。面の法線は +Z（押し出しを z 方向に中央へ寄せる）
  const outline = new THREE.Shape();
  const y0 = SPEAR.headBaseY - 0.04;
  outline.moveTo(-0.026, y0);
  outline.lineTo(0.026, y0);
  outline.quadraticCurveTo(0.062, y0 + 0.12, 0.05, y0 + 0.22);
  outline.lineTo(0, SPEAR.tipY);
  outline.lineTo(-0.05, y0 + 0.22);
  outline.quadraticCurveTo(-0.062, y0 + 0.12, -0.026, y0);
  const headGeo = new THREE.ExtrudeGeometry(outline, { depth: 0.022, bevelEnabled: false }).translate(0, 0, -0.011);
  const head = new THREE.Mesh(headGeo, steel);
  head.castShadow = true;
  g.add(head);
  addOutline(head, { thickness: 0.02 });

  const wood = 0x6b4a2e;
  const gold = 0xffd36a;
  const wrap = 0x1d2a66;
  const red = 0xd8403a;
  const fittings = new THREE.Mesh(
    paint([
      // 柄（細く長い）と、握りの巻き革（右手・左手の位置）
      { geo: new THREE.CylinderGeometry(0.022, 0.025, SPEAR.headBaseY - SPEAR.buttY, 9).translate(0, (SPEAR.headBaseY + SPEAR.buttY) / 2, 0), color: wood },
      { geo: new THREE.CylinderGeometry(0.03, 0.03, 0.2, 9).translate(0, 0, 0), color: wrap },
      { geo: new THREE.CylinderGeometry(0.03, 0.03, 0.2, 9).translate(0, -0.38, 0), color: wrap },
      // 穂先の根元の金の輪と、石突きの金具
      { geo: new THREE.CylinderGeometry(0.036, 0.03, 0.08, 9).translate(0, SPEAR.headBaseY - 0.04, 0), color: gold },
      { geo: new THREE.CylinderGeometry(0.03, 0.03, 0.03, 9).translate(0, SPEAR.headBaseY - 0.12, 0), color: gold },
      { geo: new THREE.ConeGeometry(0.03, 0.1, 8).rotateX(Math.PI).translate(0, SPEAR.buttY - 0.04, 0), color: gold },
      // 房（赤。根元の輪から垂れる）
      { geo: new THREE.ConeGeometry(0.075, 0.26, 9).rotateX(Math.PI).translate(0, SPEAR.headBaseY - 0.27, 0), color: red },
    ]),
    fitting,
  );
  fittings.castShadow = true;
  g.add(fittings);
  addOutline(fittings, { thickness: 0.018 });

  g.userData.steel = steel as ToonMaterial;
  return g;
}
