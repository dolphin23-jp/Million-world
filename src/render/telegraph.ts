import * as THREE from 'three';
import { laneOf, type LaneView, type TelegraphSource } from '../ai/telegraph';

/**
 * 敵の攻撃の予告の床表示（ADR-025）。突進型の予備動作のあいだ、通り道に向きの分かる帯（進行方向の矢印が流れる）を出す。
 * 幾何（どこに・どの濃さで）は src/ai/telegraph.ts（純粋関数）が決め、ここは描くだけ。同時に出せる本数は MAX_LANES（プールを最初に作って使い回す）。
 */

const MAX_LANES = 4;
/** 矢印 1 つぶんの床の長さ（m） */
const CELL = 1.5;
const COLOR_TRACK = new THREE.Color(1, 0.55, 0.2);
const COLOR_LOCK = new THREE.Color(1, 0.2, 0.12);
const COLOR_STRIKE = new THREE.Color(1, 0.5, 0.3);

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
  private readonly view: LaneView = { x: 0, z: 0, yaw: 0, length: 0, width: 0, intensity: 0, locked: false, striking: false };

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

  /** 毎描画フレーム。frameDt は実時間（矢印が流れる速さに使う） */
  update(enemies: readonly TelegraphSource[], frameDt: number): void {
    let n = 0;
    for (const e of enemies) {
      if (n >= MAX_LANES) break;
      if (!laneOf(e, this.view)) continue;
      const v = this.view;
      const mesh = this.meshes[n]!;
      const mat = this.mats[n]!;
      mesh.visible = true;
      mesh.position.set(v.x, 0.04, v.z);
      mesh.rotation.y = v.yaw;
      mesh.scale.set(v.width, 1, v.length);
      mat.opacity = Math.min(1, v.intensity) * 0.8;
      mat.color.copy(v.striking ? COLOR_STRIKE : v.locked ? COLOR_LOCK : COLOR_TRACK);
      const map = mat.map!;
      map.repeat.set(1, v.length / CELL);
      // 進行方向（+Z）へ矢印が流れる（v は −Z 向きに増えるので offset は減らす）。固定されたら速く、突進中はさらに速く
      map.offset.y -= frameDt * (v.striking ? 5 : v.locked ? 2.2 : 0.8);
      n++;
    }
    for (let i = n; i < MAX_LANES; i++) this.meshes[i]!.visible = false;
  }

  clear(): void {
    for (const m of this.meshes) m.visible = false;
  }
}
