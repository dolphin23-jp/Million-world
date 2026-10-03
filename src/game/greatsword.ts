import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addOutline, createToonMaterial, type ToonMaterial } from '../render/toon';

/**
 * プレースホルダーの大剣（両手持ち）。原点は右手の握り（柄の上寄りの中心）、刃先が +Y、面（幅の広い側）の法線が +Z（sword.ts と同じ約束）。
 * 柄は石突き（−Y）へ長く伸びていて、左手はその下寄りを握る（TwoHand.offset。src/character/data/greatsword.ts の GS_TWO_HAND）。
 *
 * 描画呼び出しを減らすため、刃（溜めのとき光らせる）と、金具・柄（頂点色）の 2 つのメッシュにまとめる。
 */

export const GREATSWORD = {
  /** 刃の根元（鍔の上）と先端の y（m）。剣筋の帯はこの区間の根元寄りと先端を結ぶ（player.ts の WEAPON_BLADE） */
  bladeBaseY: 0.32,
  bladeTipY: 1.62,
  /** 柄の下端（石突き）の y。左手はこの上を握る */
  pommelY: -0.4,
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
  if (!merged) throw new Error('大剣の部品の統合に失敗しました');
  return merged;
}

/** 大剣のメッシュ。userData.steel に刃の素材（溜めの光り方を変える）を入れる */
export function buildGreatsword(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'greatsword';
  const steel = createToonMaterial({
    color: 0xd6deee,
    steps: 2,
    shadowLevel: 0.55,
    rimColor: 0xffffff,
    rimStrength: 0.9,
    rimPower: 2.0,
    emissive: 0x2b3a55,
    emissiveIntensity: 0.6,
  });
  const fitting = createToonMaterial({ color: 0xffffff, vertexColors: true, steps: 2, shadowLevel: 0.55, rimStrength: 0.4 });

  // 刃: 幅 0.13m・厚み 0.026m で、先端へ細くなる。面の法線は +Z（押し出しを z 方向に中央へ寄せる）
  const outline = new THREE.Shape();
  const hw = 0.066;
  outline.moveTo(-hw, GREATSWORD.bladeBaseY - 0.16);
  outline.lineTo(hw, GREATSWORD.bladeBaseY - 0.16);
  outline.lineTo(0.056, GREATSWORD.bladeTipY - 0.2);
  outline.lineTo(0, GREATSWORD.bladeTipY);
  outline.lineTo(-0.056, GREATSWORD.bladeTipY - 0.2);
  outline.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(outline, { depth: 0.026, bevelEnabled: false }).translate(0, 0, -0.013);
  const blade = new THREE.Mesh(bladeGeo, steel);
  blade.castShadow = true;
  g.add(blade);
  addOutline(blade, { thickness: 0.022 });

  const fittings = new THREE.Mesh(
    paint([
      // 鍔（幅の広い十字）と、両端の玉
      { geo: new THREE.BoxGeometry(0.4, 0.045, 0.075).translate(0, GREATSWORD.bladeBaseY - 0.2, 0), color: 0xffd36a },
      { geo: new THREE.SphereGeometry(0.04, 10, 8).translate(0.2, GREATSWORD.bladeBaseY - 0.2, 0), color: 0xffd36a },
      { geo: new THREE.SphereGeometry(0.04, 10, 8).translate(-0.2, GREATSWORD.bladeBaseY - 0.2, 0), color: 0xffd36a },
      // 柄（長い。両手で握る）と石突き
      { geo: new THREE.CylinderGeometry(0.024, 0.026, 0.5, 10).translate(0, -0.15, 0), color: 0x1d2a66 },
      { geo: new THREE.SphereGeometry(0.05, 10, 8).translate(0, GREATSWORD.pommelY, 0), color: 0xffd36a },
    ]),
    fitting,
  );
  fittings.castShadow = true;
  g.add(fittings);
  addOutline(fittings, { thickness: 0.02 });

  g.userData.steel = steel as ToonMaterial;
  return g;
}
