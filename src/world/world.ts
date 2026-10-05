import { clampInsideArena, type Circle } from './collision';

/**
 * 世界への問い合わせの入口（M7-1。ADR-039）。体の押し出し・弾や視線の遮り・出現位置の確認は、円の半径を直接読まず、ここを通す。
 * three にも DOM にも依存しない純粋なクラス（見た目は Arena が同じデータから作る）。
 *
 * 世界 = 円形の境界（中心は原点）+ 静的な障害物（円柱・箱）。障害物は上面の高さ `top` を持ち、問い合わせは足の高さ `y`（既定 0）を取る:
 *  - 体の押し出し（moveCircle）: 上面が y + stepUp（既定 STEP_UP）より高い障害物だけが体を止める。上面が低ければ、またいで・上に立てる
 *  - 足場（groundHeight）: 体の下にある、上に立てる面の高さ（縦の動き M7-2: ジャンプで障害物の上に乗る・縁から落ちる）
 *  - 遮り（raycast / lineOfSight）: 高さ y の線を、上面が y より高い障害物が遮る（柱は鬼火を防ぐが、低い岩の上は飛び越える）
 * 障害物はすべて地面から立ち上がるものとして扱う（底の高さは持たない。浮いた足場・天井は ステージの定義（M9）で足す）。
 */

/** 円柱（柱・岩・切り株）。位置 (x, z)・半径 r・上面の高さ top */
export interface CircleObstacle {
  kind: 'circle';
  x: number;
  z: number;
  r: number;
  top: number;
  /** 掴んで登れる縁か（M7-3。ステージのデータで明示した面だけ登れる）。省略 = 登れない（乗り上がり・乗り越えができる高さの低い物は、これに関わらず越えられる） */
  climbable?: boolean;
}

/** 箱（壁・台・箱）。中心 (x, z)・半径の半分 hx / hz（箱の局所の x / z）・向き yaw（rad。three の rotation.y と同じ）・上面の高さ top */
export interface BoxObstacle {
  kind: 'box';
  x: number;
  z: number;
  hx: number;
  hz: number;
  yaw: number;
  top: number;
  /** 掴んで登れる縁か（CircleObstacle.climbable と同じ） */
  climbable?: boolean;
}

export type Obstacle = CircleObstacle | BoxObstacle;

export interface WorldDef {
  /** 境界の円の半径（中心は原点） */
  radius: number;
  obstacles: readonly Obstacle[];
}

/** 飛んでいる敵（小蝙蝠）の足の高さ（m）。低い岩・壁の上は通り、柱・高い箱には当たる */
export const FLYING_Y = 1.8;

/** 足がこの高さ（m）までの段差は、押し戻されずに乗れる（上面が y + STEP_UP 以下の障害物は体を止めない） */
export const STEP_UP = 0.45;

/**
 * 空中（ジャンプ・落下中）の足が、障害物の縁にかかれる高さ（m）。上面が足より少し高いだけなら、押し戻されずに縁に乗れる（地上の STEP_UP より小さい。
 * 大きいと、跳んだ直後に低い壁の中へ体がめり込んで見える）
 */
export const AIR_STEP_UP = 0.12;

/** 足場（上に立てる障害物の上面）を探すときの、体の中心から測る支えの半径（m）。縁から足が少しはみ出して立てる / 縁を越えると落ちる */
export const SUPPORT_RADIUS = 0.22;

/** raycast の結果（out に書く。毎回確保しない） */
export interface RayHit {
  /** 線分上の位置（0 = 始点、1 = 終点） */
  t: number;
  /** 当たった点と、そこの面の法線（XZ。外向きの単位ベクトル） */
  x: number;
  z: number;
  nx: number;
  nz: number;
  /** 当たった障害物の番号（World.obstacles の添字） */
  index: number;
}

export function createRayHit(): RayHit {
  return { t: 0, x: 0, z: 0, nx: 0, nz: 0, index: -1 };
}

/** probeLedge の結果（out に書く。毎回確保しない） */
export interface LedgeHit {
  /** 当たった障害物の番号（World.obstacles の添字） */
  index: number;
  /** 始点から面までの距離（m） */
  dist: number;
  /** 面の上の点と、面の外向きの法線（単位ベクトル） */
  x: number;
  z: number;
  nx: number;
  nz: number;
  /** 上面の高さ */
  top: number;
  /** 面から法線の逆向きに入って反対側へ抜けるまでの奥行き（m。壁の厚み・円柱の直径） */
  depth: number;
  /** 掴んで登れる縁か（Obstacle.climbable） */
  climbable: boolean;
}

export function createLedgeHit(): LedgeHit {
  return { index: -1, dist: 0, x: 0, z: 0, nx: 0, nz: 0, top: 0, depth: 0, climbable: false };
}

const EPS = 1e-9;

export class World {
  readonly radius: number;
  readonly obstacles: readonly Obstacle[];
  /** 箱ごとの cos / sin（向きの回転を毎回計算しない） */
  private readonly cos: number[] = [];
  private readonly sin: number[] = [];

  constructor(def: WorldDef) {
    this.radius = def.radius;
    this.obstacles = def.obstacles;
    for (const o of def.obstacles) {
      const yaw = o.kind === 'box' ? o.yaw : 0;
      this.cos.push(Math.cos(yaw));
      this.sin.push(Math.sin(yaw));
    }
  }

  /** 境界の中か（中心 (x, z) の点。体の半径は含めない） */
  contains(x: number, z: number): boolean {
    return x * x + z * z <= this.radius * this.radius;
  }

  /** 円を境界の内側へ収める（体の半径を引いた円の内側。clampInsideArena） */
  clampBounds(c: Circle): boolean {
    return clampInsideArena(c, 0, 0, this.radius);
  }

  /**
   * 円（体）を、足の高さ y で体を止める障害物の外へ押し出し、境界の内側へ収める。動いたら true。
   * 障害物どうしが近く、押し出した先でまた別の障害物に重なることがあるので、2 回まわす
   */
  moveCircle(c: Circle, y = 0, stepUp = STEP_UP): boolean {
    let moved = false;
    for (let pass = 0; pass < 2; pass++) {
      let any = false;
      for (let i = 0; i < this.obstacles.length; i++) {
        const o = this.obstacles[i]!;
        if (o.top <= y + stepUp) continue;
        if (this.pushOut(i, o, c)) any = true;
      }
      if (!any) break;
      moved = true;
    }
    if (this.clampBounds(c)) moved = true;
    return moved;
  }

  /** 円が、足の高さ y で体を止める障害物のどれかに重なっているか（出現位置の確認など。動かさない） */
  overlapsObstacle(c: Circle, y = 0, stepUp = STEP_UP): boolean {
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i]!;
      if (o.top <= y + stepUp) continue;
      if (this.overlaps(i, o, c)) return true;
    }
    return false;
  }

  /**
   * 足場の高さ: 点 (x, z) を中心にした支えの円（半径 SUPPORT_RADIUS）が重なっている障害物のうち、上面が足の高さ y + stepUp 以下のものの、いちばん高い上面。
   * 重なる足場がなければ 0（地面）。足の高さより上面が低い障害物は、上から降りて立てる面。y + stepUp より高い障害物は、体を止める壁で、足場には数えない
   * （moveCircle と同じ境目）。体の高さ（頭）は見ない: 天井・低い梁は作らない約束（障害物はすべて地面から立ち上がる）
   */
  groundHeight(x: number, z: number, y: number, stepUp = STEP_UP): number {
    let h = 0;
    const c = SUPPORT;
    c.x = x;
    c.z = z;
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i]!;
      if (o.top <= h || o.top > y + stepUp) continue;
      if (this.overlaps(i, o, c)) h = o.top;
    }
    return h;
  }

  /**
   * 線分 (ax, az) → (bx, bz) を高さ y で飛ばし、最初に遮る障害物（上面が y より高いもの）に当たるか。当たったら out に書いて true。
   * 始点が障害物の中なら t = 0（その場で当たり）。境界（円の縁）は見ない（弾の寿命・縁の判定は ProjectileSystem）。
   * inflate > 0 なら、障害物を inflate だけ太らせて調べる（円柱は半径 + inflate、箱は半幅 + inflate）= 半径 inflate の体が、この線に沿って
   * 動けるかの検査（体の中心を通る線が、太らせた障害物に当たらなければ、体は障害物に触れない。箱の角は四角のまま = 少し余裕を持つ側に倒れる）
   */
  raycast(ax: number, az: number, bx: number, bz: number, y: number, out: RayHit, inflate = 0): boolean {
    let best = Infinity;
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i]!;
      if (o.top <= y) continue;
      const t = o.kind === 'circle' ? rayCircle(ax, az, bx, bz, o, out, best, inflate) : this.rayBox(i, o, ax, az, bx, bz, out, best, inflate);
      if (t < best) {
        best = t;
        out.index = i;
      }
    }
    return best < Infinity;
  }

  /**
   * 乗り上がり・乗り越え・登りの縁を探す（M7-3）: 点 (x, z) から向き (dirX, dirZ)（単位ベクトル）へ maxDist までの線分が、足の高さ y で体を止める障害物
   * （上面が y + STEP_UP より高いもの）の面に最初に当たるか。当たったら、面の位置・外向きの法線・上面の高さ・奥行きを out に書いて true
   */
  probeLedge(x: number, z: number, dirX: number, dirZ: number, maxDist: number, y: number, out: LedgeHit): boolean {
    if (!this.raycast(x, z, x + dirX * maxDist, z + dirZ * maxDist, y + STEP_UP, LEDGE_RAY)) return false;
    const o = this.obstacles[LEDGE_RAY.index]!;
    out.index = LEDGE_RAY.index;
    out.dist = LEDGE_RAY.t * maxDist;
    out.x = LEDGE_RAY.x;
    out.z = LEDGE_RAY.z;
    out.nx = LEDGE_RAY.nx;
    out.nz = LEDGE_RAY.nz;
    out.top = o.top;
    out.depth = this.depthAlong(LEDGE_RAY.index, o, LEDGE_RAY.x, LEDGE_RAY.z, -LEDGE_RAY.nx, -LEDGE_RAY.nz);
    out.climbable = o.climbable === true;
    return true;
  }

  /** 2 点のあいだに、高さ y の視線・射線を遮る障害物が無いか（ロックオン・敵の視界・遠距離の敵の射線） */
  lineOfSight(ax: number, az: number, bx: number, bz: number, y: number, scratch: RayHit = SCRATCH): boolean {
    return !this.raycast(ax, az, bx, bz, y, scratch);
  }

  // ---------------------------------------------------------------- 内部

  /** 障害物 o の面の上の点 (px, pz) から、向き (dx, dz)（単位ベクトル。障害物の内側へ向かう）に進んで反対側へ抜けるまでの距離 */
  private depthAlong(i: number, o: Obstacle, px: number, pz: number, dx: number, dz: number): number {
    if (o.kind === 'circle') {
      // 面の上の点から内側へ: |p − c + s d|² = r² の 0 でない解 s = −2 (p − c)·d
      return Math.max(0, -2 * ((px - o.x) * dx + (pz - o.z) * dz));
    }
    const cs = this.cos[i]!;
    const sn = this.sin[i]!;
    const lx = (px - o.x) * cs - (pz - o.z) * sn;
    const lz = (px - o.x) * sn + (pz - o.z) * cs;
    const ldx = dx * cs - dz * sn;
    const ldz = dx * sn + dz * cs;
    let best = Infinity;
    if (Math.abs(ldx) > EPS) {
      const t = ((ldx > 0 ? o.hx : -o.hx) - lx) / ldx;
      if (t > 1e-9) best = Math.min(best, t);
    }
    if (Math.abs(ldz) > EPS) {
      const t = ((ldz > 0 ? o.hz : -o.hz) - lz) / ldz;
      if (t > 1e-9) best = Math.min(best, t);
    }
    return Number.isFinite(best) ? best : 0;
  }

  private overlaps(i: number, o: Obstacle, c: Circle): boolean {
    if (o.kind === 'circle') {
      const dx = c.x - o.x;
      const dz = c.z - o.z;
      const m = c.r + o.r;
      return dx * dx + dz * dz < m * m;
    }
    const cs = this.cos[i]!;
    const sn = this.sin[i]!;
    const dx = c.x - o.x;
    const dz = c.z - o.z;
    const lx = dx * cs - dz * sn;
    const lz = dx * sn + dz * cs;
    const qx = Math.min(o.hx, Math.max(-o.hx, lx));
    const qz = Math.min(o.hz, Math.max(-o.hz, lz));
    return (lx - qx) * (lx - qx) + (lz - qz) * (lz - qz) < c.r * c.r;
  }

  /** 円 c を障害物 o の外へ押し出す（c だけ動く）。動いたら true */
  private pushOut(i: number, o: Obstacle, c: Circle): boolean {
    if (o.kind === 'circle') return pushOutOfCircleObstacle(c, o);
    const cs = this.cos[i]!;
    const sn = this.sin[i]!;
    const dx = c.x - o.x;
    const dz = c.z - o.z;
    const lx = dx * cs - dz * sn;
    const lz = dx * sn + dz * cs;
    const qx = Math.min(o.hx, Math.max(-o.hx, lx));
    const qz = Math.min(o.hz, Math.max(-o.hz, lz));
    const ex = lx - qx;
    const ez = lz - qz;
    const d2 = ex * ex + ez * ez;
    let nlx: number;
    let nlz: number;
    let push: number;
    if (d2 > EPS) {
      const d = Math.sqrt(d2);
      if (d >= c.r) return false;
      nlx = ex / d;
      nlz = ez / d;
      push = c.r - d;
    } else {
      // 中心が箱の中: いちばん浅く抜けられる面から外へ出す
      const px = o.hx - Math.abs(lx);
      const pz = o.hz - Math.abs(lz);
      if (px < pz) {
        nlx = lx >= 0 ? 1 : -1;
        nlz = 0;
        push = px + c.r;
      } else {
        nlx = 0;
        nlz = lz >= 0 ? 1 : -1;
        push = pz + c.r;
      }
    }
    // 局所の向き (nlx, nlz) を世界の向きへ戻す（局所 = 世界 × R、世界 = 局所 × Rᵀ）
    c.x += (nlx * cs + nlz * sn) * push;
    c.z += (-nlx * sn + nlz * cs) * push;
    return true;
  }

  private rayBox(i: number, o: BoxObstacle, ax: number, az: number, bx: number, bz: number, out: RayHit, best: number, inflate: number): number {
    const hx = o.hx + inflate;
    const hz = o.hz + inflate;
    const cs = this.cos[i]!;
    const sn = this.sin[i]!;
    const adx = ax - o.x;
    const adz = az - o.z;
    const bdx = bx - o.x;
    const bdz = bz - o.z;
    const alx = adx * cs - adz * sn;
    const alz = adx * sn + adz * cs;
    const blx = bdx * cs - bdz * sn;
    const blz = bdx * sn + bdz * cs;
    const dlx = blx - alx;
    const dlz = blz - alz;
    let t0 = 0;
    let t1 = 1;
    let nx = 0;
    let nz = 0;
    // 始点が箱の中なら t = 0 の当たり（法線は始点から見て最も近い面の外向き）
    const inside = Math.abs(alx) <= hx && Math.abs(alz) <= hz;
    if (inside) {
      const px = hx - Math.abs(alx);
      const pz = hz - Math.abs(alz);
      if (px < pz) nx = alx >= 0 ? 1 : -1;
      else nz = alz >= 0 ? 1 : -1;
    } else {
      // スラブ法（x → z の順）。入る面の法線を覚える
      for (let axis = 0; axis < 2; axis++) {
        const a = axis === 0 ? alx : alz;
        const d = axis === 0 ? dlx : dlz;
        const h = axis === 0 ? hx : hz;
        if (Math.abs(d) < EPS) {
          if (Math.abs(a) > h) return Infinity;
          continue;
        }
        let ta = (-h - a) / d;
        let tb = (h - a) / d;
        let sign = -1; // −h の面から入る（法線は −軸）
        if (ta > tb) {
          const tmp = ta;
          ta = tb;
          tb = tmp;
          sign = 1;
        }
        if (ta > t0) {
          t0 = ta;
          nx = axis === 0 ? sign : 0;
          nz = axis === 1 ? sign : 0;
        }
        if (tb < t1) t1 = tb;
        if (t0 > t1) return Infinity;
      }
    }
    if (t0 >= best) return best;
    out.t = t0;
    out.x = ax + (bx - ax) * t0;
    out.z = az + (bz - az) * t0;
    // 局所の法線を世界へ
    out.nx = nx * cs + nz * sn;
    out.nz = -nx * sn + nz * cs;
    return t0;
  }
}

const SCRATCH = createRayHit();
/** probeLedge が使う線分の当たり（毎回確保しない） */
const LEDGE_RAY = createRayHit();
/** groundHeight が使う支えの円（毎回確保しない） */
const SUPPORT: Circle = { x: 0, z: 0, r: SUPPORT_RADIUS };

/** 障害物の無い世界（半径だけ。テスト・障害物の無いステージ用） */
export function openWorld(radius: number): World {
  return new World({ radius, obstacles: [] });
}

function pushOutOfCircleObstacle(c: Circle, o: CircleObstacle): boolean {
  const dx = c.x - o.x;
  const dz = c.z - o.z;
  const minD = c.r + o.r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= minD * minD) return false;
  const d = Math.sqrt(d2);
  if (d < 1e-6) {
    // ちょうど中心: +X へ逃がす
    c.x = o.x + minD;
    return true;
  }
  const k = (minD - d) / d;
  c.x += dx * k;
  c.z += dz * k;
  return true;
}

/** 線分と円柱の最初の交点。best より手前なら out に書いてその t、そうでなければ best（= 当たらない・遠い）を返す */
function rayCircle(ax: number, az: number, bx: number, bz: number, o: CircleObstacle, out: RayHit, best: number, inflate: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const fx = ax - o.x;
  const fz = az - o.z;
  const a = dx * dx + dz * dz;
  const r = o.r + inflate;
  const c = fx * fx + fz * fz - r * r;
  let t: number;
  if (c <= 0) {
    // 始点が円の中: その場で当たり。法線は中心から始点への向き
    t = 0;
  } else {
    if (a < EPS) return Infinity;
    const b = fx * dx + fz * dz;
    const disc = b * b - a * c;
    if (disc < 0) return Infinity;
    t = (-b - Math.sqrt(disc)) / a;
    if (t < 0 || t > 1) return Infinity;
  }
  if (t >= best) return best;
  const hx = ax + dx * t;
  const hz = az + dz * t;
  let nx = hx - o.x;
  let nz = hz - o.z;
  const len = Math.hypot(nx, nz);
  if (len < 1e-9) {
    nx = 1;
    nz = 0;
  } else {
    nx /= len;
    nz /= len;
  }
  out.t = t;
  out.x = hx;
  out.z = hz;
  out.nx = nx;
  out.nz = nz;
  return t;
}
