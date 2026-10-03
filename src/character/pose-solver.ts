import { Quaternion, Vector3 } from 'three';
import { eulerYPR, frameRotation, polarToVector, solveTwoBone, swingTwist, swordRotation } from './ik';
import { BONE, Rig } from './rig';

/**
 * 1 フレーム分の「ポーズの意図」から全ボーンの回転を求める（手付けアニメの心臓部）。
 *
 * 規約:
 * - 角度の回転（hips / chest / head）は idle の t=0 のポーズに対する差分で、キャラ基準（+Z 前・+Y 上・−X 右）の軸で掛ける。
 *   すべて 0 なら idle そのもの。yaw は右へ回る正、pitch は前傾が正、roll は右へ傾く正。
 * - 剣（右手）と左手は、肩を原点にした「胸の座標系」（胸の回転 Δchest だけを掛けた軸）で指定する。
 *   胸をひねれば腕と剣がいっしょに動くので、振りの弧と到達距離を管理しやすい。
 * - 足は「世界に固定した位置」で指定する（idle の足位置からのずれ x,z と持ち上げ lift）。ルートが前進しても接地した足は滑らない。
 *   足が届かないほど腰が高ければ、腰を下げて届かせる。
 * - 位置はすべてメートル。出力の hipsPos はルート（rootZ だけ前にいる）基準。
 */

export interface Posture {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface Polar {
  /** 正面(+Z)から右(−X)へ測る方位（ラジアン） */
  az: number;
  /** 水平からの仰角（ラジアン） */
  el: number;
  /** 肩（または柄）までの距離（m） */
  r: number;
}

export interface FootTarget {
  /** idle の足位置からの世界固定のずれ（m）。右 = −X、前 = +Z */
  x: number;
  z: number;
  /** 足首の持ち上げ（m） */
  lift: number;
  /** idle の向きに対する yaw（右へ回る正）・pitch（つま先が下がる正）（ラジアン） */
  yaw: number;
  pitch: number;
  /**
   * 足を「腰の座標系」で置く割合（0 = 世界固定、1 = 腰に付いて回る）。ロールのように体が回転するとき、丸めた脚が体に追従するために使う。
   * 1 のあいだの足首の位置は、腰の骨の原点から (lx, ly, lz)（腰の回転で回した向き。左 = +X、右 = −X、上 = +Y、前 = +Z）。0 と 1 の間は両者を線形に混ぜる
   */
  rel?: number;
  lx?: number;
  ly?: number;
  lz?: number;
  /** 膝の向きを「体の前」（腰の回転に従う）に追従させる割合（0 = 世界の前）。逆さになって転がるとき膝が体の前へ曲がるように */
  knee?: number;
}

export interface PoseInput {
  /** ルートの前進量（m）。足の世界位置はこれに依らない */
  rootZ: number;
  hips: Posture & { x: number; y: number; z: number };
  chest: Posture;
  head: Posture;
  /** 剣の柄の位置（右肩から、胸の座標系で） */
  grip: Polar;
  /** 刃の向き・刃の面の法線のヒント（胸の座標系） */
  blade: Vector3;
  face: Vector3;
  /** 右肘が向かう方向（胸の座標系）。肘は常に自然な側（下・外）へ曲げる */
  pole: Vector3;
  /** 左手首の位置（左肩から、胸の座標系で）と肘の向き */
  left: Polar;
  leftPole: Vector3;
  footL: FootTarget;
  footR: FootTarget;
}

export interface PoseOutput {
  /** rig.names と同じ並びの、親ローカルの回転 */
  quats: Quaternion[];
  /** Hips の位置（m。ルート基準） */
  hipsPos: Vector3;
  /** 診断用 */
  info: {
    /** 腕・脚が届かず伸び切った */
    armRClamped: boolean;
    armLClamped: boolean;
    legLClamped: boolean;
    legRClamped: boolean;
    /** 足を届かせるために腰を下げた量（m） */
    hipsDrop: number;
    /** 右手首の目標と実際のずれ（m）。0 でないと剣の位置が指定からずれている */
    gripError: number;
    /** 右上腕の挙上角（胸の下向きの軸からの角度、ラジアン）。130° を超えると脇のスキンが破れる（docs/05） */
    armRElevation: number;
    /** 右手首の曲がり（前腕の軸と手の軸のなす角、ラジアン）と、手の前腕に対するねじれ（前腕の軸まわり、符号付き） */
    wristBend: number;
    wristTwist: number;
    /** 右肘の曲がり（上腕と前腕の軸のなす角、ラジアン。0 = 伸び切り） */
    elbowBend: number;
  };
}

export function createPoseOutput(rig: Rig): PoseOutput {
  return {
    quats: rig.names.map(() => new Quaternion()),
    hipsPos: new Vector3(),
    info: { armRClamped: false, armLClamped: false, legLClamped: false, legRClamped: false, hipsDrop: 0, gripError: 0, armRElevation: 0, wristBend: 0, wristTwist: 0, elbowBend: 0 },
  };
}

const _Y = new Vector3(0, 1, 0);
const IDENTITY = new Quaternion();
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 前腕のねじれのうち、前腕の骨が受け持つ割合（残りは手首）。肘と手首にねじれを分けて、片側だけが潰れるのを避ける */
const FOREARM_TWIST_SHARE = 0.5;

export class PoseSolver {
  private readonly R: Quaternion[];
  private readonly P: Vector3[];
  private readonly ix: Record<keyof typeof BONE, number>;
  // 一時
  private readonly qa = new Quaternion();
  private readonly qb = new Quaternion();
  private readonly qc = new Quaternion();
  private readonly qd = new Quaternion();
  private readonly qe = new Quaternion();
  private readonly va = new Vector3();
  private readonly vb = new Vector3();
  private readonly vc = new Vector3();
  private readonly vd = new Vector3();
  private readonly elbow = new Vector3();
  private readonly wrist = new Vector3();
  private readonly hinge = new Vector3();
  private readonly hu = new Vector3();
  private readonly hf = new Vector3();
  private readonly dirU = new Vector3();
  private readonly dirF = new Vector3();
  private readonly hipsWorld = new Vector3();

  constructor(private readonly rig: Rig) {
    this.R = rig.names.map(() => new Quaternion());
    this.P = rig.names.map(() => new Vector3());
    const ix = {} as Record<keyof typeof BONE, number>;
    for (const k of Object.keys(BONE) as Array<keyof typeof BONE>) ix[k] = rig.mustIndex(BONE[k]);
    this.ix = ix;
  }

  solve(inp: PoseInput, out: PoseOutput): void {
    const { rig, R, P, ix } = this;
    const n = rig.names.length;
    const info = out.info;

    // ---- 体幹: idle の回転に、キャラ基準の差分回転を掛ける ----
    const dP = eulerYPR(inp.hips.yaw, inp.hips.pitch, inp.hips.roll, new Quaternion());
    const dC = eulerYPR(inp.chest.yaw, inp.chest.pitch, inp.chest.roll, new Quaternion());
    const dH = eulerYPR(inp.head.yaw, inp.head.pitch, inp.head.roll, new Quaternion());
    const torso = (i: number, delta: Quaternion): void => {
      R[i]!.copy(delta).multiply(rig.idleWorldQ[i]!);
    };
    torso(ix.hips, dP);
    torso(ix.spine02, this.qa.slerpQuaternions(dP, dC, 1 / 3));
    torso(ix.spine01, this.qa.slerpQuaternions(dP, dC, 2 / 3));
    torso(ix.spine, dC);
    torso(ix.neck, this.qa.slerpQuaternions(dC, dH, 0.5));
    torso(ix.head, dH);
    // 鎖骨は胸に従う（idle の相対姿勢のまま）
    R[ix.shoulderR]!.copy(R[ix.spine]!).multiply(rig.idleLocal[ix.shoulderR]!);
    R[ix.shoulderL]!.copy(R[ix.spine]!).multiply(rig.idleLocal[ix.shoulderL]!);

    // ---- 腰の位置。足が届かなければ下げる ----
    const hipsBase = this.hipsWorld.copy(rig.data.hipsPos).add(this.va.set(inp.hips.x, inp.hips.y, inp.hips.z + inp.rootZ));
    const lenThighL = rig.length(BONE.upLegL, BONE.legL);
    const lenShinL = rig.length(BONE.legL, BONE.footL);
    const lenThighR = rig.length(BONE.upLegR, BONE.legR);
    const lenShinR = rig.length(BONE.legR, BONE.footR);
    const ankleL = this.footWorld(ix.footL, inp.footL, new Vector3());
    const ankleR = this.footWorld(ix.footR, inp.footR, new Vector3());
    const hipOffL = this.va.copy(rig.pos[ix.upLegL]!).applyQuaternion(R[ix.hips]!);
    const hipOffR = this.vb.copy(rig.pos[ix.upLegR]!).applyQuaternion(R[ix.hips]!);
    // 腰に付いて回る足（rel）は、腰を下げても届く位置にあるので、腰を下げる量には数えない（その割合だけ減らす）
    const relL = clamp01(inp.footL.rel ?? 0);
    const relR = clamp01(inp.footR.rel ?? 0);
    const drop = Math.max(
      this.dropFor(hipsBase.y + hipOffL.y, hipsBase.x + hipOffL.x, hipsBase.z + hipOffL.z, ankleL, lenThighL + lenShinL) * (1 - relL),
      this.dropFor(hipsBase.y + hipOffR.y, hipsBase.x + hipOffR.x, hipsBase.z + hipOffR.z, ankleR, lenThighR + lenShinR) * (1 - relR),
    );
    hipsBase.y -= drop;
    info.hipsDrop = drop;
    // 腰の座標系の足首（腰の位置が決まってから）を混ぜる
    if (relL > 0) ankleL.lerp(this.va.set(inp.footL.lx ?? 0, inp.footL.ly ?? 0, inp.footL.lz ?? 0).applyQuaternion(R[ix.hips]!).add(hipsBase), relL);
    if (relR > 0) ankleR.lerp(this.va.set(inp.footR.lx ?? 0, inp.footR.ly ?? 0, inp.footR.lz ?? 0).applyQuaternion(R[ix.hips]!).add(hipsBase), relR);

    // ---- 位置（FK）。四肢の先は IK が決める ----
    P[ix.hips]!.copy(hipsBase);
    for (let i = 0; i < n; i++) {
      const p = rig.parent[i]!;
      if (p < 0) continue;
      if (i === ix.foreR || i === ix.handR || i === ix.foreL || i === ix.handL || i === ix.legR || i === ix.footR || i === ix.legL || i === ix.footL) continue;
      P[i]!.copy(rig.pos[i]!).applyQuaternion(R[p]!).add(P[p]!);
      // 四肢の根元より先の回転はあとで決まるので、ここで R を埋めるのは体幹と鎖骨まで
    }

    // ---- 右腕: 剣の位置と向き → 手の回転 → 手首の目標 → 2 ボーン IK ----
    {
      const S = P[ix.armR]!;
      const chest = dC; // 胸の座標系
      const G = polarToVector(inp.grip.az, inp.grip.el, inp.grip.r, this.vc).applyQuaternion(chest).add(S);
      const qSword = swordRotation(inp.blade, inp.face, this.qa).premultiply(chest);
      const Rhand = this.qb.copy(qSword).multiply(this.qc.copy(rig.data.grip.quat).invert());
      const Wt = this.vd.copy(rig.data.grip.pos).applyQuaternion(Rhand).multiplyScalar(-1).add(G);
      const pole = this.va.copy(inp.pole).applyQuaternion(chest);
      const l1 = rig.length(BONE.armR, BONE.foreR);
      const l2 = rig.length(BONE.foreR, BONE.handR);
      const res = solveTwoBone(S, Wt, l1, l2, pole, this.elbow, this.wrist, this.hinge);
      info.armRClamped = res.clamped;
      info.gripError = this.wrist.distanceTo(Wt);
      this.limb(ix.armR, ix.foreR, S, this.elbow, this.wrist, rig.data.hinges.armR);
      P[ix.foreR]!.copy(this.elbow);
      P[ix.handR]!.copy(this.wrist);
      // 前腕のねじれを肘と手首で分ける
      const delta = this.qd.copy(R[ix.foreR]!).invert().multiply(Rhand);
      swingTwist(delta, _Y, this.qe, this.qc);
      // 診断: 手首の曲がり（swing の角度）とねじれ（twist の符号付き角度）、肘の曲がり、上腕の挙上角
      // 手首の曲がり = 前腕の軸と、手の指の向き（手ボーンの Y 軸ではなく）のなす角
      const fingerLocal = rig.data.handFinger ?? _Y;
      const fingerDir = this.vb.copy(fingerLocal).applyQuaternion(Rhand);
      const foreDir = this.vc.copy(_Y).applyQuaternion(R[ix.foreR]!);
      info.wristBend = Math.acos(Math.max(-1, Math.min(1, fingerDir.dot(foreDir))));
      info.wristTwist = 2 * Math.atan2(this.qc.y, this.qc.w);
      if (info.wristTwist > Math.PI) info.wristTwist -= 2 * Math.PI;
      if (info.wristTwist < -Math.PI) info.wristTwist += 2 * Math.PI;
      info.elbowBend = Math.acos(Math.max(-1, Math.min(1, this.dirU.dot(this.dirF))));
      const down = this.va.set(0, -1, 0).applyQuaternion(R[ix.spine]!);
      info.armRElevation = Math.acos(Math.max(-1, Math.min(1, this.dirU.dot(down))));
      this.qc.slerp(IDENTITY, 1 - FOREARM_TWIST_SHARE); // ねじれの FOREARM_TWIST_SHARE を前腕が受け持つ
      R[ix.foreR]!.multiply(this.qc);
      R[ix.handR]!.copy(Rhand);
    }

    // ---- 左腕: 手首の位置だけ指定。手は前腕に対して idle の相対姿勢のまま ----
    {
      const S = P[ix.armL]!;
      const chest = dC;
      const Wt = polarToVector(inp.left.az, inp.left.el, inp.left.r, this.vc).applyQuaternion(chest).add(S);
      const pole = this.va.copy(inp.leftPole).applyQuaternion(chest);
      const l1 = rig.length(BONE.armL, BONE.foreL);
      const l2 = rig.length(BONE.foreL, BONE.handL);
      const res = solveTwoBone(S, Wt, l1, l2, pole, this.elbow, this.wrist, this.hinge);
      info.armLClamped = res.clamped;
      this.limb(ix.armL, ix.foreL, S, this.elbow, this.wrist, rig.data.hinges.armL);
      P[ix.foreL]!.copy(this.elbow);
      P[ix.handL]!.copy(this.wrist);
      R[ix.handL]!.copy(R[ix.foreL]!).multiply(rig.idleLocal[ix.handL]!);
    }

    // ---- 脚 ----
    this.leg(inp.footL, ix.upLegL, ix.legL, ix.footL, ix.toeL, ankleL, rig.data.hinges.legL, 1, (c) => (info.legLClamped = c));
    this.leg(inp.footR, ix.upLegR, ix.legR, ix.footR, ix.toeR, ankleR, rig.data.hinges.legR, -1, (c) => (info.legRClamped = c));

    // ---- そのほかの骨（head_end など）は親に従う ----
    for (let i = 0; i < n; i++) {
      const p = rig.parent[i]!;
      if (p < 0) continue;
      if (this.isSolved(i)) continue;
      R[i]!.copy(R[p]!).multiply(rig.idleLocal[i]!);
    }

    // ---- 親ローカルへ ----
    for (let i = 0; i < n; i++) {
      const p = rig.parent[i]!;
      const q = out.quats[i]!;
      if (p < 0) q.copy(R[i]!);
      else q.copy(R[p]!).invert().multiply(R[i]!);
    }
    out.hipsPos.copy(hipsBase);
    out.hipsPos.z -= inp.rootZ;
  }

  private isSolved(i: number): boolean {
    const x = this.ix;
    return (
      i === x.hips || i === x.spine02 || i === x.spine01 || i === x.spine || i === x.neck || i === x.head ||
      i === x.shoulderR || i === x.shoulderL || i === x.armR || i === x.foreR || i === x.handR ||
      i === x.armL || i === x.foreL || i === x.handL || i === x.upLegR || i === x.legR || i === x.footR ||
      i === x.upLegL || i === x.legL || i === x.footL || i === x.toeR || i === x.toeL
    );
  }

  /** 足首の世界目標（足は世界固定。ルートの前進量は含めない） */
  private footWorld(footIx: number, f: FootTarget, out: Vector3): Vector3 {
    const home = this.rig.idleWorldP[footIx]!;
    return out.set(home.x - f.x, home.y + f.lift, home.z + f.z);
  }

  /** 腰関節 (hx,hy,hz) から足首 a まで脚の最大長で届くために必要な腰の下げ量 */
  private dropFor(hy: number, hx: number, hz: number, a: Vector3, maxLen: number): number {
    const reach = maxLen - 0.004;
    const dxz2 = (hx - a.x) ** 2 + (hz - a.z) ** 2;
    const rem = reach * reach - dxz2;
    const needY = rem > 0 ? Math.sqrt(rem) : 0;
    return Math.max(0, hy - (a.y + needY));
  }

  /** 上腕（太腿）と前腕（脛）の回転を、肘（膝）の位置と蝶番軸から決める */
  private limb(upper: number, fore: number, S: Vector3, E: Vector3, W: Vector3, h: { u: Vector3; f: Vector3 }): void {
    const { R } = this;
    this.dirU.subVectors(E, S).normalize();
    this.dirF.subVectors(W, E).normalize();
    frameRotation(_Y, h.u, this.dirU, this.hinge, R[upper]!);
    frameRotation(_Y, h.f, this.dirF, this.hinge, R[fore]!);
  }

  private leg(
    f: FootTarget,
    up: number,
    shin: number,
    foot: number,
    toe: number,
    ankle: Vector3,
    h: { u: Vector3; f: Vector3 },
    side: 1 | -1,
    setClamped: (c: boolean) => void,
  ): void {
    const { rig, R, P } = this;
    const H = P[up]!;
    // 膝は足の向きの前方（少し外）へ出す。knee > 0 なら、体（腰）の前へ向ける
    const pole = this.va.set(side * 0.15, 0, 1).applyQuaternion(eulerYPR(f.yaw, 0, 0, this.qa));
    const knee = clamp01(f.knee ?? 0);
    if (knee > 0) pole.lerp(this.vb.set(side * 0.15, 0, 1).applyQuaternion(R[this.ix.hips]!), knee).normalize();
    const res = solveTwoBone(H, ankle, rig.length(rig.names[up]!, rig.names[shin]!), rig.length(rig.names[shin]!, rig.names[foot]!), pole, this.elbow, this.wrist, this.hinge);
    setClamped(res.clamped);
    this.limb(up, shin, H, this.elbow, this.wrist, h);
    P[shin]!.copy(this.elbow);
    P[foot]!.copy(this.wrist);
    // 足の向き: idle の足の向きに yaw・pitch を掛ける。つま先は足に固定
    eulerYPR(f.yaw, f.pitch, 0, this.qb);
    R[foot]!.copy(this.qb).multiply(rig.idleWorldQ[foot]!);
    R[toe]!.copy(R[foot]!).multiply(rig.idleLocal[toe]!);
    P[toe]!.copy(rig.pos[toe]!).applyQuaternion(R[foot]!).add(P[foot]!);
  }
}
