/**
 * 胴（骨盤〜胸）のスキンウェイトを、位置だけから作り直す（docs/05-asset-automation.md「腰まわりの再スキン」/ ADR-022）。
 *
 * 元のウェイト（Meshy の自動リグ）は、胴で次のように崩れていた（tools/waist-stress.mjs、tools/motion-sheet.mjs --mode wsum:…）:
 *  - 脇腹（Hips の +14〜+20cm）に腕（LeftArm）の重みが 50〜80%、腰（ショーツの縁）に脚（UpLeg）の重みが 65% まで漏れている。
 *    腕を上げる・脚を踏み出すと、離れているはずの脇腹・腰の皮膚が引かれて、腰が細く潰れる・縁がギザギザになる
 *  - 左右非対称（骨盤の重みの山が片側の尻にしかない、左の肩・脚の骨が体の反対側まで重みを持つ）
 *  - 胸の骨（Spine）には重みが無く、背中は肩・腕の骨が支配している
 *  - 頂点ごとのノイズ
 * そこで、胴の頂点だけ、重みを「位置の関数」として作り直す。腕・頭・髪・膝から下は元のまま:
 *
 *  1. 背骨の割り振り: 高さ y（Hips の関節から）で、骨盤〜ウエストの上端（y0）までは Hips 100%（ショーツが骨盤と一緒に動く）、
 *     そこから胸の下端（y1）までの素肌の帯で、ひねりが 1 点に集中しないよう Hips → Spine02 → Spine01 → Spine へ連続的に移し、胸（y1 より上）は Spine 100%。
 *     PoseSolver が腰・胸の回転を 0 / 1/3 / 2/3 / 1 で配るので、帯の中の回転は高さに対してなめらかに増える
 *  2. 脚との割り振り: 大腿の軸（股関節 → 膝）に沿った位置 t で、骨盤（t < −10cm）は Hips、大腿（t > +10cm）は UpLeg、その間（股関節のまわり・尻の付け根）は連続的に混ぜる。
 *     左右の脚は体の中心線からの距離で分ける（中心線で 50/50）。膝に近い大腿（t > 8〜14cm）は元の重み（膝の曲がり）を残す
 *  3. 腕の皮膚（腕の軸に、胴の中心線よりも相対的に近い頂点）は元の重みのまま。胴では腕の骨の重みを 0 にする（境目は連続的に混ぜる。判定は DEFAULTS.armR 参照）
 *  4. 体の中心線から横に 17〜23cm 以上離れた頂点（腕・手・指）は、元のまま。
 *  5. 胸より上（y > 21.5〜25.5cm）では、元の「胴の骨」の重み（Hips / Spine02 / Spine01）は Spine にまとめる（肩・首・腕の重みはそのまま）
 *  6. 肩から首の付け根（y = 25〜40cm）は、作り直しを弱めながら（元の重みを混ぜていく）、Spine から neck の骨へ重みを渡す（32〜40cm）。
 *     胸の Spine と、その上の腕に引かれる肩・首の境目を、肩の線でなく首の付け根に置く（肩の線で切ると、腕を上げるたびに背中に横帯状のずれができる）
 *
 * 位置が同じ頂点（UV の継ぎ目の複製）には同じ重みを与える（割れない）。結果は上位 4 本に制限して正規化する。
 */

export const DEFAULTS = {
  /** ウエストの上端 = ショーツの上端より少し上（m。Hips の関節から）。ここまで Hips 100% */
  y0: 0.085,
  /** 胸の下端（m）。ここから上は Spine 100%。素肌の帯（y0〜y1）でひねりを均す */
  y1: 0.245,
  /**
   * 重みの作り直しを弱め始める・やめる高さ（m）。これより上（首・頭・髪）は元の重みを残す。
   * 肩の線（35cm）より下で切ると、そこが「胸は Spine、その上は腕に引かれる」境目になり、腕を上げるたびに背中に横帯状のずれができた。首の付け根（40cm）まで延ばして首の骨へ渡す */
  yFade: [0.25, 0.4],
  /** 胸より上で、胴の骨の重みを Spine にまとめ始める・終わる高さ（m） */
  upperRemap: [0.215, 0.255],
  /** 肩の線から首にかけて、Spine から neck の骨へ重みを渡す高さ（m）。作り直しの範囲（yFade）が首の付け根まで及ぶときに使う */
  neckHandover: [0.32, 0.4],
  /**
   * 胴か腕かの判定。腕の軸（上腕・前腕の線分）までの距離 dArm を腕の半径 armR で、体の中心線までの横の距離 |x − 中心| を胴の半幅 torsoR で割り、
   * その差 u = dArm/armR − |x − 中心|/torsoR が armBlend[0] 以下なら腕の皮膚（元の重みのまま）、armBlend[1] 以上なら胴（作り直し）、間は連続的に。
   * 腕の軸からの距離だけで決めると、脇の下では腕が胴のすぐ脇にあるので、胴の脇腹まで「腕」になってしまう（元のリグは左腕の重みが脇腹・肋骨に 50〜80% 乗っていた）。
   * 相対的な近さで比べると、脇腹（腕の軸まで 8cm、中心線まで 9cm）は胴、腕の内側の皮膚（腕の軸まで 3.5cm、中心線まで 15cm）は腕と分かれる
   */
  armR: 0.055,
  torsoR: 0.11,
  armBlend: [-0.5, 0.5],
  /** 大腿の軸に沿った位置 t（m。股関節が 0、膝の向きが +）。−lo で Hips 100%、+hi で UpLeg 100% */
  legRamp: [-0.1, 0.1],
  /** 大腿の軸に沿った位置 t（m）。ここより下（大腿）は元の重み（膝の曲がりの重みを残す） */
  legKeep: [0.08, 0.14],
  /** 左右の脚を分ける、中心線からの距離（m）。±この値で一方に 100% */
  legSplit: 0.07,
  /** 胴とみなす、体の中心線からの横の距離（m）。lo 以内は作り直し、hi 以上（腕・手・指）は元のまま。手は指が手首の骨から 20cm 近く先まであり、腕の軸だけでは守れない */
  lateral: [0.17, 0.23],
  /** ひねりの帯の中の高さ → 回転の割合の、直線と smoothstep の混ぜ具合（0 = 直線、1 = smoothstep）。端を丸めて、中ほどの傾きを抑える */
  ease: 0.5,
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** 背骨の割合 φ（0 = Hips の回転、1 = 胸の回転）を、骨 4 本（Hips, Spine02, Spine01, Spine）への重みにする（隣り合う 2 本だけ） */
export function spineWeights(phi) {
  const s = Math.min(1, Math.max(0, phi)) * 3;
  if (s <= 1) return [1 - s, s, 0, 0];
  if (s <= 2) return [0, 2 - s, s - 1, 0];
  return [0, 0, 3 - s, s - 2];
}

/** 高さ y（m。Hips から）→ 背骨の回転の割合 φ */
export function spinePhi(y, p = DEFAULTS) {
  const t = clamp01((y - p.y0) / (p.y1 - p.y0));
  return (1 - p.ease) * t + p.ease * (t * t * (3 - 2 * t));
}

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function segmentDistance(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const t = clamp01(((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / (abx * abx + aby * aby + abz * abz));
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t), p[2] - (a[2] + abz * t));
}

/**
 * 胴のウェイトを作り直す。
 *  pos       Float32Array(n*3)  頂点の位置（バインド姿勢）
 *  joints    Uint16Array(n*4)   JOINTS_0
 *  weights   Float32Array(n*4)  WEIGHTS_0
 *  names     string[]           ジョイント番号 → 骨の名前
 *  jointPos  { [name]: [x, y, z] }  バインド姿勢の関節の位置（頂点と同じ座標系）
 * 戻り値: { joints, weights, stats }
 */
export function reskinTorso({ pos, joints, weights, names, jointPos }, params = {}) {
  const p = { ...DEFAULTS, ...params };
  const n = pos.length / 3;
  const id = (name) => {
    const i = names.indexOf(name);
    if (i < 0) throw new Error(`骨がありません: ${name}`);
    return i;
  };
  const HIPS = id('Hips'), S02 = id('Spine02'), S01 = id('Spine01'), SP = id('Spine'), ULL = id('LeftUpLeg'), ULR = id('RightUpLeg'), NECK = id('neck');
  const spineIds = [HIPS, S02, S01, SP];
  const jp = (name) => {
    const v = jointPos[name];
    if (!v) throw new Error(`関節の位置がありません: ${name}`);
    return v;
  };
  const hipsY = jp('Hips')[1];
  /** 体の中心線の x（両股関節の中点） */
  const xMid = (jp('LeftUpLeg')[0] + jp('RightUpLeg')[0]) / 2;
  const armSegs = [];
  for (const side of ['Left', 'Right']) armSegs.push([jp(`${side}Arm`), jp(`${side}ForeArm`)], [jp(`${side}ForeArm`), jp(`${side}Hand`)]);
  const thigh = (side) => {
    const a = jp(`${side}UpLeg`), b = jp(`${side}Leg`);
    const l = dist3(a, b);
    return { a, u: [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l] };
  };
  const legL = thigh('Left'), legR = thigh('Right');
  const along = (leg, q) => (q[0] - leg.a[0]) * leg.u[0] + (q[1] - leg.a[1]) * leg.u[1] + (q[2] - leg.a[2]) * leg.u[2];

  // 位置が同じ頂点をまとめる
  const key = new Map();
  const groupOf = new Int32Array(n);
  const groups = [];
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
    let g = key.get(k);
    if (g === undefined) { g = groups.length; key.set(k, g); groups.push([]); }
    groups[g].push(i);
    groupOf[i] = g;
  }

  const outJ = new Uint16Array(n * 4);
  const outW = new Float32Array(n * 4);
  const stats = { groups: groups.length, changed: 0, replaced: 0, maxShift: 0 };
  for (const members of groups) {
    const i0 = members[0];
    const q = [pos[i0 * 3], pos[i0 * 3 + 1], pos[i0 * 3 + 2]];
    const y = q[1] - hipsY;
    // 元の重み（複製の平均）
    const w = new Map();
    for (const i of members) for (let k = 0; k < 4; k++) {
      const wk = weights[i * 4 + k];
      if (wk > 0) w.set(joints[i * 4 + k], (w.get(joints[i * 4 + k]) ?? 0) + wk / members.length);
    }
    const orig = new Map(w);
    // 4. 胸より上: 胴の骨の重みを Spine にまとめる
    const m = smoothstep(p.upperRemap[0], p.upperRemap[1], y);
    if (m > 0) {
      let low = 0;
      for (const b of [HIPS, S02, S01]) { const v = w.get(b) ?? 0; low += v * m; w.set(b, v * (1 - m)); }
      w.set(SP, (w.get(SP) ?? 0) + low);
    }
    // 作り直す度合い a
    const aH = 1 - smoothstep(p.yFade[0], p.yFade[1], y);
    let a = aH * (1 - smoothstep(p.lateral[0], p.lateral[1], Math.abs(q[0] - xMid)));
    if (a > 0) {
      let dArm = 9;
      for (const [s0, s1] of armSegs) dArm = Math.min(dArm, segmentDistance(q, s0, s1));
      a *= smoothstep(p.armBlend[0], p.armBlend[1], dArm / p.armR - Math.abs(q[0] - xMid) / p.torsoR);
    }
    // 左右の脚への割り振り
    const sigma = smoothstep(-p.legSplit, p.legSplit, q[0] - xMid);
    const tL = along(legL, q), tR = along(legR, q);
    if (a > 0) {
      const tNear = sigma * tL + (1 - sigma) * tR;
      a *= 1 - smoothstep(p.legKeep[0], p.legKeep[1], tNear);
    }
    if (a > 0) {
      const lamL = sigma * smoothstep(p.legRamp[0], p.legRamp[1], tL);
      const lamR = (1 - sigma) * smoothstep(p.legRamp[0], p.legRamp[1], tR);
      const sw = spineWeights(spinePhi(y, p));
      const trunk = new Map();
      trunk.set(ULL, lamL);
      trunk.set(ULR, lamR);
      const rest = 1 - lamL - lamR;
      const toNeck = smoothstep(p.neckHandover[0], p.neckHandover[1], y);
      spineIds.forEach((b, k) => trunk.set(b, (trunk.get(b) ?? 0) + rest * (1 - toNeck) * sw[k]));
      if (toNeck > 0) trunk.set(NECK, rest * toNeck);
      // 元 × (1 − a) + 作り直し × a
      const next = new Map();
      for (const [b, v] of w) next.set(b, v * (1 - a));
      for (const [b, v] of trunk) next.set(b, (next.get(b) ?? 0) + v * a);
      w.clear();
      for (const [b, v] of next) w.set(b, v);
      stats.replaced += a > 0.999 ? 1 : 0;
    }
    // 上位 4 本に制限して正規化
    const top = [...w.entries()].filter(([, v]) => v > 1e-5).sort((x, y2) => y2[1] - x[1]).slice(0, 4);
    const sum = top.reduce((s, [, v]) => s + v, 0) || 1;
    let shift = 0;
    for (const [b, v] of top) shift += Math.abs(v / sum - (orig.get(b) ?? 0));
    if (shift > 1e-4) stats.changed++;
    stats.maxShift = Math.max(stats.maxShift, shift);
    for (const i of members) {
      for (let k = 0; k < 4; k++) {
        const e = top[k];
        outJ[i * 4 + k] = e ? e[0] : 0;
        outW[i * 4 + k] = e ? e[1] / sum : 0;
      }
    }
  }
  return { joints: outJ, weights: outW, stats };
}
