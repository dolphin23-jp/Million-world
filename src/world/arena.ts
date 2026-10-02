import * as THREE from 'three';
import { addOutline, createToonMaterial } from '../render/toon';

/**
 * デモ用アリーナ: 円形の石床、縁、柱、浮遊クリスタル。
 * 移動の手触りを見るために床には格子模様を入れる（地面の基準がないと速度感が分からない）。
 */

export const ARENA_RADIUS = 14;

function makeFloorTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d9d4c7';
  ctx.fillRect(0, 0, size, size);
  // 大きな石畳タイル
  const n = 4;
  const cell = size / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const shade = 0.94 + ((x * 7 + y * 13) % 5) * 0.012;
      ctx.fillStyle = `rgb(${Math.round(217 * shade)}, ${Math.round(212 * shade)}, ${Math.round(199 * shade)})`;
      ctx.fillRect(x * cell + 3, y * cell + 3, cell - 6, cell - 6);
    }
  }
  ctx.strokeStyle = 'rgba(90, 80, 110, 0.32)';
  ctx.lineWidth = 5;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * cell);
    ctx.lineTo(size, i * cell);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(7, 7);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class Arena {
  readonly group = new THREE.Group();
  readonly radius = ARENA_RADIUS;
  private readonly crystals: THREE.Mesh[] = [];

  constructor() {
    this.group.name = 'arena';

    // 床
    const floorMat = createToonMaterial({
      color: 0xffffff,
      map: makeFloorTexture(),
      steps: 3,
      shadowLevel: 0.55,
      rimStrength: 0,
    });
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(this.radius, this.radius + 0.6, 1.2, 96), floorMat);
    floor.position.y = -0.6;
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.group.add(floor);
    addOutline(floor, { thickness: 0.02 });

    // 縁のリング（明るい縁取り）
    const rimMat = createToonMaterial({ color: 0xf2e7c9, steps: 2, shadowLevel: 0.6, rimStrength: 0.2 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(this.radius, 0.22, 12, 96), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.02;
    rim.castShadow = true;
    rim.receiveShadow = true;
    this.group.add(rim);
    addOutline(rim, { thickness: 0.02 });

    // 柱
    const pillarMat = createToonMaterial({ color: 0xbfc6dc, steps: 3, shadowLevel: 0.45, rimColor: 0xdde8ff, rimStrength: 0.3 });
    const capMat = createToonMaterial({ color: 0x8e9ac4, steps: 2, shadowLevel: 0.5 });
    const pillarGeo = new THREE.CylinderGeometry(0.45, 0.55, 4.2, 10);
    const capGeo = new THREE.BoxGeometry(1.3, 0.35, 1.3);
    const count = 8;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.PI / count;
      const r = this.radius - 1.6;
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(Math.cos(a) * r, 2.1, Math.sin(a) * r);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.group.add(pillar);
      addOutline(pillar, { thickness: 0.03 });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(Math.cos(a) * r, 4.35, Math.sin(a) * r);
      cap.castShadow = true;
      this.group.add(cap);
      addOutline(cap, { thickness: 0.03 });
    }

    // 浮遊クリスタル（発光 → ブルームの効き具合を確認する目印）
    const crystalGeo = new THREE.OctahedronGeometry(0.45, 0);
    const palette = [0x7ff0ff, 0xffb3f5, 0xb9ff8a, 0xffd36a];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const mat = createToonMaterial({
        color: palette[i]!,
        emissive: palette[i]!,
        emissiveIntensity: 0.45,
        steps: 2,
        shadowLevel: 0.7,
        rimStrength: 0.6,
      });
      const c = new THREE.Mesh(crystalGeo, mat);
      c.position.set(Math.cos(a) * 6, 2.2, Math.sin(a) * 6);
      c.castShadow = true;
      this.group.add(c);
      addOutline(c, { thickness: 0.035 });
      this.crystals.push(c);
    }
  }

  /** 描画時の演出更新（ゲームロジックには影響しない） */
  animate(timeSec: number): void {
    this.crystals.forEach((c, i) => {
      c.rotation.y = timeSec * 0.8 + i;
      c.position.y = 2.2 + Math.sin(timeSec * 1.6 + i * 1.3) * 0.25;
    });
  }
}
