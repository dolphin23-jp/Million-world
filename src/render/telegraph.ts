import * as THREE from 'three';
import { circleOf, laneCount, laneOf, type CircleView, type LaneView, type TelegraphSource } from '../ai/telegraph';

/**
 * 敵の攻撃の予告の床表示（ADR-025・027）。突進・飛び道具の予備動作のあいだ、通り道に向きの分かる帯（進行方向の矢印が流れる）を出す。
 * 全周の攻撃（岩鬼の地ならし）には、敵を中心にした円を出す（縁の線 + 内側から満ちていく円。ガード不能は色を変える）。
 * 幾何（どこに・どの濃さで）は src/ai/telegraph.ts（純粋関数）が決め、ここは描くだけ。同時に出せる数は MAX_LANES / MAX_CIRCLES（プールを最初に作って使い回す）。
 */

const MAX_LANES = 16;
/** 矢印 1 つぶんの床の長さ（m） */
const CELL = 1.5;
const COLOR_TRACK = new THREE.Color(1, 0.55, 0.2);
const COLOR_LOCK = new THREE.Color(1, 0.2, 0.12);
const COLOR_STRIKE = new THREE.Color(1, 0.5, 0.3);
/** ガード不能の攻撃の予告の色（赤と見分けがつく赤紫。予備動作の色分け） */
const COLOR_UNBLOCKABLE = new THREE.Color(1, 0.18, 0.62);
const COLOR_UNBLOCKABLE_STRIKE = new THREE.Color(1, 0.7, 0.9);

/** 進行方向（+Z）を向く矢印と、帯の縁の線を描いたテクスチャ。canvas の上が v = 1 で、床では −Z になるので、矢印は下向きに描く */
function makeTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  // 縁の線
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(0, 0, 5, size);
  g.fillRect(size - 5, 0, 5, size);
  // 矢印（下向きの V 字を 2 重に）
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 11;
  g.lineJoin = 'miter';
  for (const y0 of [18, 66]) {
    g.beginPath();
    g.moveTo(size * 0.2, y0);
    g.lineTo(size * 0.5, y0 + 36);
    g.lineTo(size * 0.8, y0);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class TelegraphLanes {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly mats: THREE.MeshBasicMaterial[] = [];
  private readonly view: LaneView = { x: 0, z: 0, yaw: 0, length: 0, width: 0, intensity: 0, locked: false, striking: false, unblockable: false };

  constructor() {
    this.group.name = 'telegraph-lanes';
    // 始点が原点、+Z へ長さ 1、幅 1 の板（床に寝かせる）
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, 0.5);
    const base = makeTexture();
    for (let i = 0; i < MAX_LANES; i++) {
      const map = base.clone();
      map.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({ map, color: COLOR_LOCK, transparent: true, opacity: 0, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.mats.push(mat);
    }
  }

  /** 毎描画フレーム。frameDt は実時間（矢印が流れる速さに使う）。扇・輪に弾を撃つ技は、弾の本数ぶんの帯を出す */
  update(enemies: readonly TelegraphSource[], frameDt: number): void {
    let n = 0;
    for (const e of enemies) {
      const count = laneCount(e.attackDef);
      for (let k = 0; k < count && n < MAX_LANES; k++) {
        if (!laneOf(e, this.view, k)) break;
        const v = this.view;
        const mesh = this.meshes[n]!;
        const mat = this.mats[n]!;
        mesh.visible = true;
        mesh.position.set(v.x, 0.04, v.z);
        mesh.rotation.y = v.yaw;
        mesh.scale.set(v.width, 1, v.length);
        // 本数が多いとき（輪）は、1 本ずつを薄くして重なる中心が白飛びしないように
        mat.opacity = Math.min(1, v.intensity) * (count > 1 ? 0.78 : 0.8);
        mat.color.copy(v.unblockable ? (v.striking ? COLOR_UNBLOCKABLE_STRIKE : COLOR_UNBLOCKABLE) : v.striking ? COLOR_STRIKE : v.locked ? COLOR_LOCK : COLOR_TRACK);
        const map = mat.map!;
        map.repeat.set(1, v.length / CELL);
        // 進行方向（+Z）へ矢印が流れる（v は −Z 向きに増えるので offset は減らす）。固定されたら速く、突進中はさらに速く
        map.offset.y -= frameDt * (v.striking ? 5 : v.locked ? 2.2 : 0.8);
        n++;
      }
    }
    for (let i = n; i < MAX_LANES; i++) this.meshes[i]!.visible = false;
  }

  clear(): void {
    for (const m of this.meshes) m.visible = false;
  }
}

const MAX_CIRCLES = 4;

/** 円の予告の縁の線（太い輪 + 内側のうすい面）と、内側から満ちる円（縁へ向けてやや濃いグラデーション）を描いたテクスチャ */
function makeCircleTextures(): { ring: THREE.CanvasTexture; fill: THREE.CanvasTexture } {
  const size = 256;
  const make = (draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, size, size);
    draw(g);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  const mid = size / 2;
  const ring = make((g) => {
    // 内側のうすい面
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.beginPath();
    g.arc(mid, mid, mid - 10, 0, Math.PI * 2);
    g.fill();
    // 縁の太い輪
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 9;
    g.beginPath();
    g.arc(mid, mid, mid - 6, 0, Math.PI * 2);
    g.stroke();
    // 内側の細い輪（縁が二重に見えて、円の外周が読みやすい）
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(mid, mid, mid - 22, 0, Math.PI * 2);
    g.stroke();
  });
  const fill = make((g) => {
    const grad = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(0.8, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0.8)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(mid, mid, mid - 2, 0, Math.PI * 2);
    g.fill();
  });
  return { ring, fill };
}

/** 全周の攻撃の予告（円）。縁の輪は常に半径いっぱい、内側の円が予備動作の進みに合わせて満ちていく（満ちたら攻撃） */
export class TelegraphCircles {
  readonly group = new THREE.Group();
  private readonly rings: THREE.Mesh[] = [];
  private readonly fills: THREE.Mesh[] = [];
  private readonly ringMats: THREE.MeshBasicMaterial[] = [];
  private readonly fillMats: THREE.MeshBasicMaterial[] = [];
  private readonly view: CircleView = { x: 0, z: 0, radius: 0, intensity: 0, fill: 0, locked: false, striking: false, unblockable: false };

  constructor() {
    this.group.name = 'telegraph-circles';
    // 中心が原点、半径 1（幅 2）の板を床に寝かせる
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    const tex = makeCircleTextures();
    for (let i = 0; i < MAX_CIRCLES; i++) {
      const mk = (map: THREE.Texture, order: number, store: THREE.Mesh[], mats: THREE.MeshBasicMaterial[]): void => {
        const mat = new THREE.MeshBasicMaterial({ map, color: COLOR_LOCK, transparent: true, opacity: 0, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false;
        mesh.renderOrder = order;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        store.push(mesh);
        mats.push(mat);
      };
      mk(tex.fill, 2, this.fills, this.fillMats);
      mk(tex.ring, 3, this.rings, this.ringMats);
    }
  }

  /** 毎描画フレーム */
  update(enemies: readonly TelegraphSource[]): void {
    let n = 0;
    for (const e of enemies) {
      if (n >= MAX_CIRCLES) break;
      if (!circleOf(e, this.view)) continue;
      const v = this.view;
      const ring = this.rings[n]!;
      const fill = this.fills[n]!;
      const rm = this.ringMats[n]!;
      const fm = this.fillMats[n]!;
      const color = v.unblockable ? (v.striking ? COLOR_UNBLOCKABLE_STRIKE : COLOR_UNBLOCKABLE) : v.striking ? COLOR_STRIKE : v.locked ? COLOR_LOCK : COLOR_TRACK;
      ring.visible = true;
      ring.position.set(v.x, 0.045, v.z);
      ring.scale.set(v.radius, 1, v.radius);
      rm.color.copy(color);
      rm.opacity = Math.min(1, v.intensity) * 0.9;
      // 満ちる円: 半径が fill で大きくなる（満ちきった瞬間に攻撃が出る）。攻撃が出たあとは全面が光る
      const r = Math.max(0.001, v.radius * v.fill);
      fill.visible = v.fill > 0.01;
      fill.position.set(v.x, 0.05, v.z);
      fill.scale.set(r, 1, r);
      fm.color.copy(color);
      fm.opacity = Math.min(1, v.intensity) * (v.striking ? 0.85 : 0.5);
      n++;
    }
    for (let i = n; i < MAX_CIRCLES; i++) {
      this.rings[i]!.visible = false;
      this.fills[i]!.visible = false;
    }
  }

  clear(): void {
    for (const m of this.rings) m.visible = false;
    for (const m of this.fills) m.visible = false;
  }
}

