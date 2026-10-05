import * as THREE from 'three';
import { addOutline, createToonMaterial } from '../render/toon';
import { ARENA_HAZARDS, ARENA_PROPS, ARENA_RADIUS, ARENA_WORLD } from './data/arena-props';
import { World } from './world';

/**
 * デモ用アリーナ: 円形の石床、縁、柱・岩・壁・箱（障害物）、浮遊クリスタル。
 * 移動の手触りを見るために床には格子模様を入れる（地面の基準がないと速度感が分からない）。
 * 障害物の位置・大きさは data/arena-props.ts の表（当たりの World と同じ）から作る。
 * 壊せる物（木箱・樽。M7-4d）は障害物ごとの Group に入れ、壊れたら隠す・叩かれたら揺らす。床の危険地帯（炎の床。M7-4e）は光る床と炎で見せる。
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
  /** 壊せる物（World.obstacles の添字 → 見た目の Group）。壊れたら visible = false、叩かれたら wobble を起こして揺らす */
  private readonly breakables = new Map<number, THREE.Group>();
  private readonly wobbles = new Map<number, number>();
  /** 炎の床の見た目: 光る床の材質（明滅）と、炎の円錐（ゆらぎ） */
  private readonly fireGlows: THREE.MeshStandardMaterial[] = [];
  private readonly flames: { mesh: THREE.Mesh; phase: number; baseY: number }[] = [];

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
    // 掴んで登れる縁（Obstacle.climbable）の縁取りは金色（登れる面が見て分かるように。M7-3b）
    const climbTrimMat = createToonMaterial({ color: 0xf2c76a, emissive: 0xf2c76a, emissiveIntensity: 0.18, steps: 2, shadowLevel: 0.7 });
    const pillarGeo = new THREE.CylinderGeometry(0.45, 0.55, 4.2, 10);
    const capGeo = new THREE.BoxGeometry(1.3, 0.35, 1.3);
    const add = (mesh: THREE.Mesh, thickness = 0.03): void => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      addOutline(mesh, { thickness });
    };
    // 壊せる物（M7-4d）: 木箱（板の帯で締めた箱）と樽（鉄の輪）。障害物ごとに Group にまとめる（壊れたら隠す・叩かれたら揺らす）
    const woodMat = createToonMaterial({ color: 0xc08c52, steps: 3, shadowLevel: 0.5, rimColor: 0xffe2b0, rimStrength: 0.2 });
    const woodDarkMat = createToonMaterial({ color: 0x7a4f2c, steps: 2, shadowLevel: 0.55 });
    const ironMat = createToonMaterial({ color: 0x5a6070, steps: 2, shadowLevel: 0.5, rimColor: 0xc8d4ff, rimStrength: 0.3 });
    const addTo = (group: THREE.Group, mesh: THREE.Mesh, thickness = 0.02): void => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      addOutline(mesh, { thickness });
    };
    for (let i = 0; i < ARENA_PROPS.length; i++) {
      const prop = ARENA_PROPS[i]!;
      const o = prop.obstacle;
      if (prop.style === 'crate' && o.kind === 'box') {
        const g = new THREE.Group();
        g.position.set(o.x, 0, o.z);
        g.rotation.y = o.yaw;
        const body = new THREE.Mesh(new THREE.BoxGeometry(o.hx * 2, o.top, o.hz * 2), woodMat);
        body.position.y = o.top / 2;
        addTo(g, body, 0.025);
        for (const f of [0.22, 0.78]) {
          const band = new THREE.Mesh(new THREE.BoxGeometry(o.hx * 2 + 0.05, 0.09, o.hz * 2 + 0.05), woodDarkMat);
          band.position.y = o.top * f;
          addTo(g, band, 0.015);
        }
        const lid = new THREE.Mesh(new THREE.BoxGeometry(o.hx * 2 + 0.08, 0.07, o.hz * 2 + 0.08), woodMat);
        lid.position.y = o.top - 0.035;
        addTo(g, lid, 0.015);
        this.group.add(g);
        this.breakables.set(i, g);
        continue;
      }
      if (prop.style === 'barrel' && o.kind === 'circle') {
        const g = new THREE.Group();
        g.position.set(o.x, 0, o.z);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.88, o.r * 0.88, o.top, 14), woodMat);
        body.position.y = o.top / 2;
        addTo(g, body, 0.025);
        for (const f of [0.2, 0.8]) {
          const hoop = new THREE.Mesh(new THREE.TorusGeometry(o.r * 0.9, 0.028, 6, 18), ironMat);
          hoop.rotation.x = Math.PI / 2;
          hoop.position.y = o.top * f;
          addTo(g, hoop, 0.012);
        }
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.84, o.r * 0.84, 0.05, 14), woodDarkMat);
        lid.position.y = o.top - 0.025;
        addTo(g, lid, 0.012);
        this.group.add(g);
        this.breakables.set(i, g);
        continue;
      }
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
        // 低い岩: ごつごつした多角柱。上面は当たりと同じ高さ o.top の平らな面（ジャンプで上に乗れる高さなので、足の置き場が見た目とずれないように）
        const rock = new THREE.Mesh(makeRockGeometry(o.r, o.top, o.x * 3.1 + o.z), rockMat);
        rock.position.set(o.x, o.top / 2, o.z);
        add(rock);
      } else if ((prop.style === 'wall' || prop.style === 'block') && o.kind === 'box') {
        const mat = prop.style === 'wall' ? columnMat : blockMat;
        const body = new THREE.Mesh(new THREE.BoxGeometry(o.hx * 2, o.top, o.hz * 2), mat);
        body.position.set(o.x, o.top / 2, o.z);
        body.rotation.y = o.yaw;
        add(body);
        // 上面の縁取り（明るい帯。乗れる・登れる高さが見て分かるように）
        const trim = new THREE.Mesh(new THREE.BoxGeometry(o.hx * 2 + 0.08, 0.1, o.hz * 2 + 0.08), o.climbable ? climbTrimMat : blockTopMat);
        // 帯の上面は面より 1cm だけ高い（同じ高さだと重なってちらつく）。人が乗る面なので、それ以上は盛らない
        trim.position.set(o.x, o.top - 0.04, o.z);
        trim.rotation.y = o.yaw;
        trim.castShadow = false;
        add(trim, 0.02);
      }
    }

    // 床の危険地帯（M7-4e）: 炎の床。灰色の焦げた床が内側から橙に光り（明滅）、縁に明るい輪、炎が揺れる。踏むと燃える場所だと遠くから分かるように
    for (const h of ARENA_HAZARDS) {
      const glow = new THREE.MeshStandardMaterial({ color: 0x2c140c, emissive: new THREE.Color(0xff5a18), emissiveIntensity: 0.6, roughness: 1 });
      this.fireGlows.push(glow);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(h.r, 40), glow);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(h.x, 0.03, h.z);
      disc.receiveShadow = false;
      this.group.add(disc);
      const rimMatFire = new THREE.MeshStandardMaterial({ color: 0x402010, emissive: new THREE.Color(0xffb347), emissiveIntensity: 1.1, roughness: 1 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(h.r, 0.07, 6, 48), rimMatFire);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(h.x, 0.05, h.z);
      this.group.add(ring);
      const flameMat = new THREE.MeshStandardMaterial({ color: 0xff7a20, emissive: new THREE.Color(0xffc04a), emissiveIntensity: 1.2, roughness: 1 });
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + h.x;
        const rad = k === 0 ? 0 : h.r * (0.35 + 0.4 * ((k * 37) % 5) / 5);
        const hgt = 0.7 + 0.35 * ((k * 53) % 4) / 4;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2, hgt, 6), flameMat);
        cone.position.set(h.x + Math.cos(a) * rad, hgt / 2, h.z + Math.sin(a) * rad);
        this.group.add(cone);
        this.flames.push({ mesh: cone, phase: k * 1.3 + h.z, baseY: hgt });
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

  /** 壊せる物の見た目を、壊れた（隠す）/ 戻した（出す）に合わせる（World.setActive と一緒に呼ぶ）。壊せる物でない添字は何もしない */
  setBroken(index: number, broken: boolean): void {
    const g = this.breakables.get(index);
    if (!g) return;
    g.visible = !broken;
    if (!broken) {
      g.rotation.z = 0;
      this.wobbles.delete(index);
    }
  }

  /** 壊せる物が叩かれた: 少し揺らす（描画の演出だけ） */
  pulse(index: number): void {
    if (this.breakables.has(index)) this.wobbles.set(index, 1);
  }

  /** 戦闘のやり直し: 壊れた物をすべて元に戻す */
  restoreAll(): void {
    for (const i of this.breakables.keys()) this.setBroken(i, false);
  }

  /** 描画時の演出更新（ゲームロジックには影響しない） */
  animate(timeSec: number): void {
    for (const [i, w] of this.wobbles) {
      const g = this.breakables.get(i);
      const next = w - 0.06;
      if (!g || next <= 0) {
        if (g) g.rotation.z = 0;
        this.wobbles.delete(i);
        continue;
      }
      this.wobbles.set(i, next);
      if (g.visible) g.rotation.z = Math.sin(next * 38) * 0.07 * next;
    }
    for (const m of this.fireGlows) m.emissiveIntensity = 0.55 + 0.2 * Math.sin(timeSec * 5) + 0.08 * Math.sin(timeSec * 13.7);
    for (const f of this.flames) {
      const k = 0.75 + 0.35 * Math.sin(timeSec * 7 + f.phase) + 0.12 * Math.sin(timeSec * 17.3 + f.phase * 2);
      f.mesh.scale.y = k;
      f.mesh.position.y = (f.baseY * k) / 2;
      f.mesh.rotation.z = Math.sin(timeSec * 3 + f.phase) * 0.12;
    }
    this.crystals.forEach((c, i) => {
      c.rotation.y = timeSec * 0.8 + i;
      c.position.y = 2.2 + Math.sin(timeSec * 1.6 + i * 1.3) * 0.25;
    });
  }
}

/**
 * 低い岩の形: 八角柱を側面だけ不規則にゆがめた多角柱（中ほどが少しふくらむ）。上面の高さは top のまま平ら（乗れる面）。
 * 半径 r は当たりの円の半径（上面の縁は r の 0.94〜1.06 倍に収まる）。seed でゆがみが岩ごとに変わる
 */
function makeRockGeometry(r: number, top: number, seed: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(r * 0.94, r * 1.06, top, 8, 2);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (x === 0 && z === 0) continue; // 上面・底面の中心
    const a = Math.atan2(z, x);
    const t = pos.getY(i) / top + 0.5; // 0 = 底、1 = 上面
    const k = (1 + 0.07 * Math.sin(a * 3 + seed) + 0.05 * Math.sin(a * 5 + seed * 2)) * (1 + 0.1 * Math.sin(Math.PI * t));
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}
