import * as THREE from 'three';
import { addOutline, createToonMaterial } from '../render/toon';

/**
 * プレースホルダーの剣（M0 から流用）。柄の根元が原点、刃先が +Y（docs/03 の正規化規約と同じ）。
 * Tripo で生成した剣に差し替えるときも同じ原点・向きに正規化する。
 */
export function buildSword(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'sword';
  const steel = createToonMaterial({
    color: 0xdfe6f2,
    steps: 2,
    shadowLevel: 0.55,
    rimColor: 0xffffff,
    rimStrength: 0.9,
    rimPower: 2.0,
    emissive: 0x2b3a55,
    emissiveIntensity: 0.6,
  });
  const accent = createToonMaterial({ color: 0xffd36a, steps: 2, shadowLevel: 0.6, rimStrength: 0.4 });
  const grip = createToonMaterial({ color: 0x1d2a66, steps: 2, shadowLevel: 0.5, rimStrength: 0.3 });

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.014), steel);
  blade.position.y = 0.6;
  blade.castShadow = true;
  g.add(blade);
  addOutline(blade, { thickness: 0.02 });

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 4), steel);
  tip.position.y = 1.16;
  tip.rotation.y = Math.PI / 4;
  tip.scale.set(1, 1, 0.45);
  g.add(tip);
  addOutline(tip, { thickness: 0.02 });

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.045, 0.06), accent);
  guard.position.y = 0.1;
  g.add(guard);
  addOutline(guard, { thickness: 0.02 });

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.2, 8), grip);
  handle.position.y = 0;
  g.add(handle);
  addOutline(handle, { thickness: 0.02 });

  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), accent);
  pommel.position.y = -0.11;
  g.add(pommel);
  addOutline(pommel, { thickness: 0.02 });
  return g;
}
