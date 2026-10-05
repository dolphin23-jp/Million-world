import * as THREE from 'three';
import { addOutline, createToonMaterial } from '../render/toon';
import { ARENA_PROPS, ARENA_RADIUS, ARENA_WORLD } from './data/arena-props';
import { World } from './world';

/**
 * デモ用アリーナ: 円形の石床、縁、柱・岩・壁・箱（障害物）、浮遊クリスタル。
 * 移動の手触りを見るために床には格子模様を入れる（地面の基準がないと速度感が分からない）。
 * 障害物の位置・大きさは data/arena-props.ts の表（当たりの World と同じ）から作る。
 */

export { ARENA_RADIUS };

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
  /** 世界への問い合わせ（体の押し出し・弾や視線の遮り）。障害物の見た目はこのデータから作ってある */
  readonly world = new World(ARENA_WORLD);
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

    // 障害物（柱・折れた柱・岩・壁・箱）。当たりは World、見た目はここ（同じ表 ARENA_PROPS から）
    const pillarMat = createToonMaterial({ color: 0xbfc6dc, steps: 3, shadowLevel: 0.45, rimColor: 0xdde8ff, rimStrength: 0.3 });
    const capMat = createToonMaterial({ color: 0x8e9ac4, steps: 2, shadowLevel: 0.5 });
    const columnMat = createToonMaterial({ color: 0xc9c2b2, steps: 3, shadowLevel: 0.45, rimColor: 0xfff1d0, rimStrength: 0.25 });
    const rockMat = createToonMaterial({ color: 0xa9a49a, steps: 3, shadowLevel: 0.42, rimColor: 0xe9e2d2, rimStrength: 0.2 });
    const blockMat = createToonMaterial({ color: 0xd2c9b4, steps: 3, shadowLevel: 0.5, rimColor: 0xfff1d0, rimStrength: 0.25 });
    const blockTopMat = createToonMaterial({ color: 0xe6dcc3, steps: 2, shadowLevel: 0.6 });
    const pillarGeo = new THREE.CylinderGeometry(0.45, 0.55, 4.2, 10);
    const capGeo = new THREE.BoxGeometry(1.3, 0.35, 1.3);
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const add = (mesh: THREE.Mesh, thickness = 0.03): void => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      addOutline(mesh, { thickness });
    };
    for (const prop of ARENA_PROPS) {
      const o = prop.obstacle;
      if (prop.style === 'pillar' && o.kind === 'circle') {
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.set(o.x, 2.1, o.z);
        add(pillar);
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.set(o.x, 4.35, o.z);
        cap.receiveShadow = false;
        add(cap);
      } else if (prop.style === 'column' && o.kind === 'circle') {
        // 折れた太い柱: 台座 + 柱身（上面 = o.top）+ 足元の欠片
        const base = new THREE.Mesh(new THREE.BoxGeometry(o.r * 2.3, 0.28, o.r * 2.3), capMat);
        base.position.set(o.x, 0.14, o.z);
        add(base);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.88, o.r, o.top, 12), columnMat);
        shaft.position.set(o.x, o.top / 2, o.z);
        add(shaft);
        const chip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.4), columnMat);
        chip.position.set(o.x + o.r * 1.5, 0.15, o.z + o.r * 0.6);
        chip.rotation.y = 0.7;
        add(chip, 0.02);
      } else if (prop.style === 'rock' && o.kind === 'circle') {
        // 低い岩: 十二面体を、上面が o.top になるよう縦に潰す（下半分は床の下）
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.scale.set(o.r * 1.08, o.top, o.r * 1.08);
        rock.position.set(o.x, 0, o.z);
        rock.rotation.y = o.x * 3.1 + o.z;
        add(rock);
      } else if ((prop.style === 'wall' || prop.style === 'block') && o.kind === 'box') {
        const mat = prop.style === 'wall' ? columnMat : blockMat;
        const body = new THREE.Mesh(new THREE.BoxGeometry(o.hx * 2, o.top, o.hz * 2), mat);
        body.position.set(o.x, o.top / 2, o.z);
        body.rotation.y = o.yaw;
        add(body);
        // 上面の縁取り（明るい帯。登れる高さが見て分かるように）
        const trim = new THREE.Mesh(new THREE.BoxGeometry(o.hx * 2 + 0.08, 0.1, o.hz * 2 + 0.08), blockTopMat);
        trim.position.set(o.x, o.top + 0.04, o.z);
        trim.rotation.y = o.yaw;
        trim.castShadow = false;
        add(trim, 0.02);
      }
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
