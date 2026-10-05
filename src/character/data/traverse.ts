import type { AuthoredAttack, AuthoredKey, Vec3Tuple } from '../authoring';
import { TRAVERSE } from '../../combat/data/traverse';
import { quantize, type TraverseKind } from '../../combat/traverse';
import { STEP_UP, type Obstacle } from '../../world/world';

/**
 * 乗り上がり（mantle）・乗り越え（vault）・掴んで登る（climb）の手付けクリップ（M7-3。ADR-041・042）。高さ・前進量ごとに生成関数で作る（スキルの生成関数と同じ作り）。
 *
 * 座標は「世界」: 原点 = クリップの始点（体の中心。面から faceZ 手前）の床、+Z = 面の正面へ向かう向き、+Y = 上、右 = −X（キャラの座標と同じ）。
 * 面は z = faceZ にあり、障害物の上面は高さ height。rootZ（体の前進量）・rootY（体の高さ）は sim が従う（Player）。足と手は世界座標で書く
 * （足の z・lift は世界の位置・高さ。手は gripAt / leftAt）。体を上げるあいだ、手は上面に付いたまま。
 *
 * 武器は見えなくする（HeroVisual。traverse 状態のあいだ剣・盾を隠す）ので、両手を自由に使える。右手の握りは柄の位置の指定だが、
 * 剣を持っていないので、手のひらを上面について指を前へ向ける向き（blade = 指の向き、face = 手の甲）で書く。
 */

/** クリップの種類・上面までの高さ（m）・始点から終点までの前進量（m。クリップの rootZ の終端）。値は刻みに丸める */
export interface TraverseSpec {
  kind: TraverseKind;
  height: number;
  span: number;
}

export function traverseSpec(kind: TraverseKind, height: number, span: number): TraverseSpec {
  return { kind, height: quantize(height, TRAVERSE.heightStep), span: quantize(span, TRAVERSE.spanStep) };
}

/** クリップ名（ルート曲線の拡縮の基準にもなる。同じ仕様なら同じ名前） */
export function traverseName(s: TraverseSpec): string {
  return `${s.kind}@${s.height.toFixed(2)}@${s.span.toFixed(2)}`;
}

const cache = new Map<string, AuthoredAttack>();

/** 仕様（丸め済み）に対するクリップの定義。同じ仕様では同じものを返す（HeroVisual が焼くのも sim が曲線を読むのもこれ） */
export function traverseDef(spec: TraverseSpec): AuthoredAttack {
  const name = traverseName(spec);
  let def = cache.get(name);
  if (!def) {
    def = spec.kind === 'mantle' ? buildMantle(name, spec.height, spec.span) : spec.kind === 'climb' ? buildClimb(name, spec.height, spec.span) : buildVault(name, spec.height, spec.span);
    cache.set(name, def);
  }
  return def;
}

/**
 * 世界の障害物から、起こりうる乗り上がり・乗り越え・登りのクリップの仕様（丸め済み）を挙げる。読み込みのときに焼いておく（初めて越えるときのひっかかりを避ける）。
 * 奥行きは面の正面から見た厚み（円柱 = 直径、箱 = 2 つの辺）。ここに無い組み合わせ（岩の上から壁へ、など）は、使うときに焼く
 */
export function traverseSpecsFor(obstacles: readonly Obstacle[]): TraverseSpec[] {
  const out = new Map<string, TraverseSpec>();
  const add = (s: TraverseSpec): void => void out.set(traverseName(s), s);
  for (const o of obstacles) {
    if (o.top <= STEP_UP || o.top > TRAVERSE.climbMax) continue;
    const depths = o.kind === 'circle' ? [2 * o.r] : [2 * o.hx, 2 * o.hz];
    if (o.top > TRAVERSE.mantleMax) {
      // 高い縁: 登れる縁だけ、掴んで登る
      if (o.climbable) for (const d of depths) add(traverseSpec('climb', o.top, TRAVERSE.faceZ + Math.min(TRAVERSE.standZ, d / 2)));
      continue;
    }
    for (const d of depths) {
      add(traverseSpec('mantle', o.top, TRAVERSE.faceZ + Math.min(TRAVERSE.standZ, d / 2)));
      if (o.top <= TRAVERSE.vault.maxHeight && d <= TRAVERSE.vault.maxDepth) add(traverseSpec('vault', o.top, TRAVERSE.faceZ + d + TRAVERSE.vault.landZ));
    }
  }
  return [...out.values()];
}

const F = TRAVERSE.faceZ;
const HANDS_MIN = 0.7; // これより低い乗り上がりは、手を上面につかない（またぐ）
const HAND_Z = F + 0.1; // 手を置く位置（面から 0.1m 奥）
const HAND_X = 0.17; // 左右の手の間隔の半分

/** 面の正面（+Z）へ指を向け、手の甲を上にした右手の向き（世界座標） */
const PALM_DOWN = { gripAtBlade: [0, 0, 1] as Vec3Tuple, gripAtFace: [0, 1, 0] as Vec3Tuple };

// ---------------------------------------------------------------- 乗り上がり

/**
 * 手を上面について体を持ち上げ、片足ずつ上へ乗せて立つ。0.70 秒。
 * 体の高さは「腰の世界の高さ」から決める: 手を上面（高さ H）につけているあいだ、肩が手から腕の届く範囲（約 0.5m）に収まるよう、腰は H + 0.15 より上へ上げない
 * （上げすぎると手が届かず、手首が伸び切る）。手を離してから、上面に乗せた足で立ち上がる。rootY = 腰の高さ − 立ちの腰の高さ − hips.y
 */
function buildMantle(name: string, H: number, S: number): AuthoredAttack {
  const hands = H >= HANDS_MIN;
  const lean = Math.max(0, H - 0.585); // 手をついている最後（0.3）の rootY（腰が H + 0.15 になる高さ。腰を 0.25 沈めたまま）
  const keys: AuthoredKey[] = [
    // ---- ルート: 面に寄り添って持ち上がる（rootY）→ 縁を越えて上面の上へ（rootZ） ----
    { t: 0.083, ease: 'lin', rootZ: 0, rootY: 0 },
    { t: 0.19, ease: 'out', rootY: lean * 0.5, rootZ: 0.04 },
    { t: 0.3, ease: 'io', rootY: lean, rootZ: 0.12 },
    { t: 0.42, ease: 'io', rootY: H * 0.7 + lean * 0.3, rootZ: F + 0.04 },
    { t: 0.55, ease: 'out', rootY: H, rootZ: S },
    { t: 0.7, ease: 'lin', rootY: H, rootZ: S },

    // ---- 腰（立ちの高さからの差）と体幹: 沈んで前へ倒れ → 引き上げ → 起き上がる ----
    { t: 0.083, ease: 'io', hips: { y: -0.26, z: 0.05, pitch: 22 }, chest: { pitch: 30 }, head: { pitch: -18 } },
    { t: 0.19, ease: 'io', hips: { y: -0.25, z: 0.1, pitch: 40 }, chest: { pitch: 50 }, head: { pitch: -32 } },
    { t: 0.3, ease: 'io', hips: { y: -0.25, z: 0.08, pitch: 42 }, chest: { pitch: 48 }, head: { pitch: -30 } },
    { t: 0.42, ease: 'io', hips: { y: -0.22, z: 0.04, pitch: 22 }, chest: { pitch: 26 }, head: { pitch: -16 } },
    { t: 0.55, ease: 'out', hips: { y: -0.06, z: 0, pitch: 6 }, chest: { pitch: 8 }, head: { pitch: -4 } },
    { t: 0.7, ease: 'io', hips: { y: 0, z: 0, pitch: 0 }, chest: { pitch: 0 }, head: { pitch: 0 } },

    // ---- 足（世界座標）: 左足が先に上面へ、右足は壁に沿ってぶら下がってから上面へ。最後に両足が体の真下 ----
    { t: 0.083, ease: 'lin', footL: { rel: 0, z: 0, lift: 0 }, footR: { rel: 0, z: 0, lift: 0 } },
    { t: 0.24, ease: 'io', footL: { rel: 0, z: F + 0.14, lift: H, arc: 0.08 } },
    { t: 0.42, ease: 'lin', footL: { z: F + 0.14, lift: H } },
    { t: 0.56, ease: 'io', footL: { z: S + 0.02, lift: H, arc: 0.04 } },
    { t: 0.19, ease: 'io', footR: { rel: 0, z: 0.02, lift: 0 } },
    { t: 0.3, ease: 'io', footR: { rel: 1, lx: -0.09, ly: -0.5, lz: 0.1, knee: 0 } },
    { t: 0.38, ease: 'io', footR: { rel: 1, lx: -0.09, ly: -0.38, lz: 0.28, knee: 0 } },
    { t: 0.48, ease: 'io', footR: { rel: 0, z: F + 0.16, lift: H, arc: 0.05 } },
    { t: 0.58, ease: 'io', footR: { rel: 0, z: S - 0.02, lift: H } },
  ];

  // ---- 腕: 手を上面について支え（世界座標）、体が上がったら離して idle へ ----
  if (hands) {
    keys.push(
      { t: 0.083, ease: 'io', gripAt: [-HAND_X, H + 0.03, HAND_Z], ...PALM_DOWN, leftAt: [HAND_X, H + 0.03, HAND_Z] },
      { t: 0.28, ease: 'lin', gripAt: [-HAND_X, H + 0.03, HAND_Z], leftAt: [HAND_X, H + 0.03, HAND_Z] },
      { t: 0.38, ease: 'io', gripAt: null, leftAt: null },
    );
  }
  // 胸の座標系の腕（手を世界に付けているあいだは混ぜ具合 k が打ち消す）: 前へ伸ばし → idle へ
  keys.push(
    { t: 0.083, ease: 'io', grip: [14, -40, 0.4], left: [-22, -48, 0.42], pole: [-0.6, -0.8, 0.1], leftPole: [0.6, -0.8, 0.1] },
    { t: 0.38, ease: 'io', grip: [20, -50, 0.38], left: [-30, -52, 0.4], pole: [-0.6, -0.8, 0.1], leftPole: [0.6, -0.8, 0.1] },
    { t: 0.7, ease: 'io', grip: 'idle', left: 'idle', pole: 'idle', leftPole: 'idle', blade: 'idle', face: 'idle' },
  );
  return { name, duration: 0.7, keys };
}

// ---------------------------------------------------------------- 乗り越え

/**
 * 手をついて体を水平に近く倒し、脚を振り越えて向こう側へ着地する。0.55 秒。S = 始点から向こう側の着地点までの前進量。
 * 右手を上面（高さ H）につくあいだ、肩が手から約 0.5m 以内に収まるよう、体を前へ大きく倒して（腰のピッチ 75°）腰の高さを H + 0.3 までにする。
 * 脚は体の後ろへ伸ばして面の手前を通し、手をついた体の上で振り越える。
 */
function buildVault(name: string, H: number, S: number): AuthoredAttack {
  const r1 = Math.max(0.05, H - 0.78); // 手をつく（0.16）
  const r2 = Math.max(0.08, H - 0.6); // 体が面の真上（0.26）
  const r3 = Math.max(0.05, H - 0.7); // 脚を振り越えたあと（0.36）
  // 奥行き（壁の厚み）= 前進量 − 面までの距離 − 着地の距離。手は上面の中ほどにつく
  const handZ = F + Math.max(0.15, (S - F - TRAVERSE.vault.landZ) / 2);
  const keys: AuthoredKey[] = [
    // ---- ルート: 面の手前から体を持ち上げ、手をついて面の上を越え、向こう側で着地 ----
    { t: 0.083, ease: 'lin', rootZ: 0, rootY: 0 },
    { t: 0.16, ease: 'out', rootY: r1, rootZ: F - 0.1 },
    { t: 0.26, ease: 'io', rootY: r2, rootZ: F + 0.1 },
    { t: 0.36, ease: 'io', rootY: r3, rootZ: F + 0.38 },
    { t: 0.46, ease: 'in', rootY: 0, rootZ: S - 0.12 },
    { t: 0.55, ease: 'out', rootY: 0, rootZ: S },

    // ---- 腰と体幹: 低く構え → 手をついて体を前へ倒し（水平に近く）→ 脚を振り越えて起き上がり → 着地で沈む ----
    { t: 0.083, ease: 'io', hips: { y: -0.18, z: 0.04, pitch: 20 }, chest: { pitch: 28 }, head: { pitch: -16 } },
    { t: 0.16, ease: 'io', hips: { y: -0.12, z: 0.05, pitch: 55, roll: -6 }, chest: { pitch: 62 }, head: { pitch: -40 } },
    { t: 0.26, ease: 'io', hips: { y: -0.1, z: 0.04, pitch: 75, roll: -12 }, chest: { pitch: 82 }, head: { pitch: -55 } },
    { t: 0.36, ease: 'io', hips: { y: -0.1, z: 0.02, pitch: 35, roll: -4 }, chest: { pitch: 40 }, head: { pitch: -25 } },
    { t: 0.46, ease: 'io', hips: { y: -0.2, z: 0.04, pitch: 14 }, chest: { pitch: 18 }, head: { pitch: -10 } },
    { t: 0.55, ease: 'out', hips: { y: -0.04, z: 0, pitch: 6 }, chest: { pitch: 8 }, head: { pitch: -4 } },

    // ---- 足: 地面を蹴って腰に付いて伸ばし（体の後ろへ）→ 振り越して前へ畳み → 向こう側の地面へ（世界固定）。着地の足はルートの真下の少し前後 ----
    { t: 0.083, ease: 'lin', footL: { rel: 0, z: 0, lift: 0 }, footR: { rel: 0, z: 0, lift: 0 } },
    { t: 0.16, ease: 'io', footL: { rel: 1, lx: 0.1, ly: -0.66, lz: 0, knee: 0 }, footR: { rel: 1, lx: -0.1, ly: -0.7, lz: -0.05, knee: 0 } },
    { t: 0.26, ease: 'io', footL: { rel: 1, lx: 0.16, ly: -0.7, lz: -0.05, knee: 0 }, footR: { rel: 1, lx: -0.06, ly: -0.72, lz: -0.02, knee: 0 } },
    { t: 0.36, ease: 'io', footL: { rel: 1, lx: 0.12, ly: -0.5, lz: 0.28, knee: 0 }, footR: { rel: 1, lx: -0.1, ly: -0.56, lz: 0.22, knee: 0 } },
    // 着地の直前に脚を伸ばして地面を探す（世界固定へ切り替えるときに、腰が引き下げられないように、足首が地面の近くにあるうちに切り替える）
    { t: 0.42, ease: 'io', footL: { rel: 1, lx: 0.1, ly: -0.78, lz: 0.12, knee: 0 }, footR: { rel: 1, lx: -0.1, ly: -0.8, lz: 0.06, knee: 0 } },
    { t: 0.46, ease: 'out', footL: { rel: 0, z: S - 0.06, lift: 0 }, footR: { rel: 0, z: S - 0.24, lift: 0 } },
    { t: 0.55, ease: 'io', footL: { rel: 0, z: S - 0.06, lift: 0 }, footR: { rel: 0, z: S - 0.1, lift: 0, arc: 0.05 } },

    // ---- 腕: 右手を上面について支え、越えたら離して idle へ。左腕は体の脇へ ----
    { t: 0.083, ease: 'io', grip: [14, -40, 0.4], left: [-22, -48, 0.42], pole: [-0.6, -0.8, 0.1], leftPole: [0.6, -0.8, 0.1] },
    { t: 0.16, ease: 'io', gripAt: [-HAND_X, H + 0.03, handZ], ...PALM_DOWN },
    { t: 0.28, ease: 'lin', gripAt: [-HAND_X, H + 0.03, handZ], left: [-50, -30, 0.4] },
    { t: 0.36, ease: 'io', gripAt: null },
    { t: 0.55, ease: 'io', grip: 'idle', left: 'idle', pole: 'idle', leftPole: 'idle', blade: 'idle', face: 'idle' },
  ];
  return { name, duration: 0.55, keys };
}

// ---------------------------------------------------------------- 掴んで登る

/** 立った腰の高さ（m）と、腰を 0.25 沈めた構えの腰の高さ。腰の世界の高さ = 足元の原点の高さ rootY + 0.985 + 腰の差 hips.y */
const HIP_STAND = 0.985;
const HIP_CROUCH = HIP_STAND - 0.25;

/** 跳びついて縁を掴み、ぶら下がって、引き上げて、上に立つ。1.0 秒前後（高さで変わる）。縁を掴む手は世界座標（上面の縁の少し奥）に付いたまま体が上がる */
function buildClimb(name: string, H: number, S: number): AuthoredAttack {
  // ぶら下がるときの腰の高さ = 縁 − 0.52m（肩 = 腰 + 0.45 なので、肩は縁の 7cm 下。腕を曲げて掴む。腰を下げると腕が伸び切り、肩より手が高すぎると腕の挙上角が 130° を超えて脇の変形が破れる）。立っていて届く高さ（腰 0.735 まで沈めた構え）より高ければ、跳びつく（rootY が持ち上がる）
  const hang = Math.max(HIP_CROUCH - 0.015, H - 0.52);
  const rg = Math.max(0, hang - HIP_CROUCH); // 掴む瞬間の足元の高さ（跳びつく量）
  const leap = rg > 0.05;
  const t1 = 0.083; // 構えの終わり（整列）
  const tg = t1 + (leap ? 0.16 : 0.1); // 縁を掴む
  const th = tg + 0.1; // ぶら下がって勢いを止める
  const tp = th + 0.26; // 引き上げて腰が縁の上（H + 0.15）まで来る（乗り上がりの 0.3 と同じ姿勢）
  const end = tp + 0.4;
  const lean = Math.max(0, H - 0.585); // 乗り上がりと同じ: 腰が H + 0.15 になる rootY（腰を 0.25 沈めたまま）
  const grabX = HAND_X;
  const grabZ = F + 0.06;
  const hy = (hipsWorld: number, root: number): number => hipsWorld - HIP_STAND - root; // 腰の差 = 腰の世界の高さ − 立ちの腰 − ルートの高さ
  const keys: AuthoredKey[] = [
    // ---- ルート: 構え → （跳びついて）縁を掴む → ぶら下がり → 引き上げ → 縁を越えて上面の上へ ----
    { t: t1, ease: 'lin', rootZ: 0, rootY: 0 },
    { t: tg, ease: 'out', rootY: rg, rootZ: 0.04 },
    { t: th, ease: 'io', rootY: Math.max(0, rg - 0.03), rootZ: 0.08 },
    { t: tp, ease: 'io', rootY: lean, rootZ: 0.12 },
    { t: tp + 0.12, ease: 'io', rootY: H * 0.7 + lean * 0.3, rootZ: F + 0.04 },
    { t: tp + 0.25, ease: 'out', rootY: H, rootZ: S },
    { t: end, ease: 'lin', rootY: H, rootZ: S },

    // ---- 腰と体幹: 沈んで構え → 腕を伸ばして伸び上がり（ほぼ直立） → ぶら下がり → 引き上げて前へ倒れ → 起き上がる ----
    { t: t1, ease: 'io', hips: { y: -0.26, z: 0.05, pitch: 20 }, chest: { pitch: 26 }, head: { pitch: -16 } },
    { t: tg, ease: 'io', hips: { y: hy(hang, rg), z: 0.08, pitch: 16 }, chest: { pitch: 12 }, head: { pitch: 4 } },
    { t: th, ease: 'io', hips: { y: hy(hang - 0.03, Math.max(0, rg - 0.03)), z: 0.08, pitch: 18 }, chest: { pitch: 14 }, head: { pitch: 2 } },
    { t: tp, ease: 'io', hips: { y: -0.25, z: 0.08, pitch: 42 }, chest: { pitch: 48 }, head: { pitch: -30 } },
    { t: tp + 0.12, ease: 'io', hips: { y: -0.22, z: 0.04, pitch: 22 }, chest: { pitch: 26 }, head: { pitch: -16 } },
    { t: tp + 0.25, ease: 'out', hips: { y: -0.06, z: 0, pitch: 6 }, chest: { pitch: 8 }, head: { pitch: -4 } },
    { t: end, ease: 'io', hips: { y: 0, z: 0, pitch: 0 }, chest: { pitch: 0 }, head: { pitch: 0 } },

    // ---- 手（世界座標）: 縁の少し奥を掴んだまま、体が上がって肩が縁を越えるまで。そのあと離す ----
    // 構えが終わるまでは手を縁へ寄せない（k = 0。寄せ始めが早いと、体がまだ低いのに手だけ縁へ引かれて腕が伸び切る）。跳びついて掴むまでに k を 0 → 1 へ
    { t: t1, ease: 'lin', gripAt: null, leftAt: null },
    { t: tg, ease: 'io', gripAt: [-grabX, H + 0.03, grabZ], ...PALM_DOWN, leftAt: [grabX, H + 0.03, grabZ] },
    { t: tp - 0.02, ease: 'lin', gripAt: [-grabX, H + 0.03, grabZ + 0.04], leftAt: [grabX, H + 0.03, grabZ + 0.04] },
    { t: tp + 0.1, ease: 'io', gripAt: null, leftAt: null },
    // 胸の座標系の腕: 構えで上へ伸ばし → 手を離したあとは idle へ
    { t: t1, ease: 'io', grip: [18, 38, 0.42], left: [-24, 42, 0.42], pole: [-0.6, -0.8, 0.1], leftPole: [0.6, -0.8, 0.1] },
    { t: tp + 0.1, ease: 'io', grip: [20, -50, 0.38], left: [-30, -52, 0.4], pole: [-0.6, -0.8, 0.1], leftPole: [0.6, -0.8, 0.1] },
    { t: end, ease: 'io', grip: 'idle', left: 'idle', pole: 'idle', leftPole: 'idle', blade: 'idle', face: 'idle' },

    // ---- 足（世界座標）: 構えでは地面。跳びつく高さなら、跳ぶとき腰に付いてぶら下がる。引き上げで左膝を上げて上面に乗せ、右足が続く ----
    { t: t1, ease: 'lin', footL: { rel: 0, z: 0, lift: 0 }, footR: { rel: 0, z: 0, lift: 0 } },
    ...(leap
      ? [
          { t: t1 + 0.04, ease: 'io' as const, footL: { rel: 1, lx: 0.1, ly: -0.6, lz: 0.05, knee: 0 }, footR: { rel: 1, lx: -0.1, ly: -0.62, lz: 0.02, knee: 0 } },
          { t: th, ease: 'io' as const, footL: { rel: 1, lx: 0.1, ly: -0.64, lz: 0.08, knee: 0 }, footR: { rel: 1, lx: -0.1, ly: -0.66, lz: 0.04, knee: 0 } },
        ]
      : [{ t: th, ease: 'lin' as const, footL: { rel: 0, z: 0, lift: 0 }, footR: { rel: 0, z: 0, lift: 0 } }]),
    { t: tp - 0.14, ease: 'io', footL: { rel: 1, lx: 0.1, ly: -0.5, lz: 0.12, knee: 0 }, footR: { rel: 1, lx: -0.1, ly: -0.56, lz: 0.06, knee: 0 } },
    { t: tp - 0.06, ease: 'io', footL: { rel: 0, z: F + 0.14, lift: H, arc: 0.08 }, footR: { rel: 1, lx: -0.09, ly: -0.42, lz: 0.2, knee: 0 } },
    { t: tp + 0.12, ease: 'lin', footL: { z: F + 0.14, lift: H }, footR: { rel: 1, lx: -0.09, ly: -0.38, lz: 0.28, knee: 0 } },
    { t: tp + 0.18, ease: 'io', footR: { rel: 0, z: F + 0.16, lift: H, arc: 0.05 } },
    { t: tp + 0.26, ease: 'io', footL: { z: S + 0.02, lift: H, arc: 0.04 } },
    { t: tp + 0.28, ease: 'io', footR: { z: S - 0.02, lift: H } },
  ];
  return { name, duration: end, keys };
}
