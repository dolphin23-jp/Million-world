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
  /**
   * 両手持ち: 右手の握りから、柄の石突き側へこの距離（m）離れたところを左手が握る。あれば（かつ rig.data.gripL があれば）`left` は使わず、
   * 左手の位置と向きを右手と同じ握り（鏡像）で柄に合わせる。手首は、手のひらの中心が柄の軸の上に来る位置に置く
   */
  twoHand?: number;
  /**
   * 両手持ちの左手を柄の軸まわりに回す角 ψ（ラジアン）を指定する。省略するとソルバが手首のねじれ・曲がりが小さい ψ を選ぶ（info.rollL に出る）。
   * 焼き込み（authoring.ts）が、フレーム間で ψ が跳ばないよう変化量を制限するために使う
   */
  leftRoll?: number;
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
    /** 両手持ちのときの左手首の曲がり・ねじれ（右と同じ定義。両手持ちでなければ 0） */
    wristBendL: number;
    wristTwistL: number;
    /** 両手持ちの左手を、柄の軸まわりに回した角（ラジアン。右手の握りの鏡像の向きからの差。0 = 鏡像のまま） */
    rollL: number;
  };
}

export function createPoseOutput(rig: Rig): PoseOutput {
  return {
    quats: rig.names.map(() => new Quaternion()),
    hipsPos: new Vector3(),
    info: { armRClamped: false, armLClamped: false, legLClamped: false, legRClamped: false, hipsDrop: 0, gripError: 0, armRElevation: 0, wristBend: 0, wristTwist: 0, elbowBend: 0, wristBendL: 0, wristTwistL: 0, rollL: 0 },
  };
}

const _Y = new Vector3(0, 1, 0);
const IDENTITY = new Quaternion();
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 前腕のねじれのうち、前腕の骨が受け持つ割合（残りは手首）。肘と手首にねじれを分けて、片側だけが潰れるのを避ける */
const FOREARM_TWIST_SHARE = 0.5;

/**
 * 両手持ちの左手の「柄の軸まわりの回り方」ψ の選び方（ADR-023）。柄は円柱なので、左手は柄の軸まわりに自由に回して握れる。
 * 右手の握りの鏡像（ψ = 0）のままだと、剣の面を斬りの面に合わせる右手のロール（最大 ±180°）に左手が引きずられて、
 * 左手首が前腕に対して 150° 以上ねじれた（手の甲を貫く・平手が柄に載る）。手首のねじれ・曲がりが小さい ψ を選ぶ。
 * 費用 = (ねじれ ÷ twistScale)² + (曲がりの超過 ÷ bendScale)² + reg × (ψ ÷ 90°)² + 届かないときの罰。ψ は ±max の範囲で、粗く走査して黄金分割で詰める。
 * ψ はそのフレームの姿勢だけで決まる（前のフレームに依らない）ので、continueFrom のつなぎ目でも姿勢が一致する
 */
const LEFT_ROLL = {
  max: (120 * Math.PI) / 180,
  /** 手首のねじれの目安（これで費用 1）。手首の曲がりは BEND_OK を超えた分だけ数える */
  twistScale: (60 * Math.PI) / 180,
  bendOk: (80 * Math.PI) / 180,
  bendScale: (40 * Math.PI) / 180,
  /** 鏡像（ψ = 0）から離れることへの弱い罰。同じくらい楽な向きが複数あるとき、鏡像に近いほうを選ぶ */
  reg: 0.35,
  /** 腕が届かない（伸び切る）向きへの罰 */
  clampPenalty: 6,
  coarse: 13,
  refineIters: 14,
} as const;

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
  /** 右腕の計算で求めた、世界の剣の回転と柄の位置・刃の向き（両手持ちの左手が使う） */
  private readonly swordQ = new Quaternion();
  private readonly gripWorld = new Vector3();
  private readonly bladeWorld = new Vector3();
  private readonly handLQ = new Quaternion();
  private readonly handL0 = new Quaternion();
  private readonly palmL = new Vector3();
  private readonly poleL = new Vector3();
  private readonly wristT = new Vector3();
  /** solve() の間だけ有効な out.info への参照（leftTwoHand が診断値を書く） */
  private infoRef: PoseOutput['info'] | null = null;
  private lastTwistL = 0;
  private lastBendL = 0;
  private lastClampedL = false;

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
    this.infoRef = info;

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
      this.swordQ.copy(qSword);
      this.gripWorld.copy(G);
      this.bladeWorld.set(0, 1, 0).applyQuaternion(qSword);
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

    // ---- 左腕: 手首の位置を指定（手は前腕に対して idle の相対姿勢のまま）。両手持ちは、右手と同じ握りで柄に合わせる ----
    {
      const S = P[ix.armL]!;
      const chest = dC;
      const gl = rig.data.gripL;
      if (inp.twoHand !== undefined && gl !== undefined) {
        this.leftTwoHand(inp.twoHand, inp.leftRoll, gl, S, inp.leftPole, chest);
      } else {
        const Wt = polarToVector(inp.left.az, inp.left.el, inp.left.r, this.vc).applyQuaternion(chest).add(S);
        const pole = this.va.copy(inp.leftPole).applyQuaternion(chest);
        const l1 = rig.length(BONE.armL, BONE.foreL);
        const l2 = rig.length(BONE.foreL, BONE.handL);
        const res = solveTwoBone(S, Wt, l1, l2, pole, this.elbow, this.wrist, this.hinge);
        info.armLClamped = res.clamped;
        this.limb(ix.armL, ix.foreL, S, this.elbow, this.wrist, rig.data.hinges.armL);
        P[ix.foreL]!.copy(this.elbow);
        P[ix.handL]!.copy(this.wrist);
        info.wristBendL = 0;
        info.wristTwistL = 0;
        info.rollL = 0;
        R[ix.handL]!.copy(R[ix.foreL]!).multiply(rig.idleLocal[ix.handL]!);
      }
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

  /**
   * 両手持ちの左手（ADR-023）。左手の向き = 剣の向き × 左手の握りの逆（右手の Rhand と同じ作り）を、柄の軸まわりに ψ だけ回したもの。
   * 手のひらの中心を、右手の握りから石突き側へ twoHand（m）の柄の軸の上に置き、そこから手首を逆算して 2 ボーン IK で腕を解く。
   * ψ は手首のねじれ・曲がりが小さくなる向きを選ぶ（LEFT_ROLL）。前腕のねじれは肘と手首で分ける（右腕と同じ）。
   */
  private leftTwoHand(offset: number, inpRoll: number | undefined, gl: { pos: Vector3; quat: Quaternion }, S: Vector3, leftPole: Vector3, chest: Quaternion): void {
    const { rig, R, P, ix } = this;
    const info = this.infoRef!;
    this.handL0.copy(this.swordQ).multiply(this.qc.copy(gl.quat).invert());
    this.palmL.copy(this.gripWorld).addScaledVector(this.bladeWorld, -offset);
    this.poleL.copy(leftPole).applyQuaternion(chest);
    const l1 = rig.length(BONE.armL, BONE.foreL);
    const l2 = rig.length(BONE.foreL, BONE.handL);
    const finger = rig.data.handFingerL ?? _Y;
    const attempt = (psi: number): number => {
      this.handLQ.setFromAxisAngle(this.bladeWorld, psi).multiply(this.handL0);
      this.wristT.copy(gl.pos).applyQuaternion(this.handLQ).multiplyScalar(-1).add(this.palmL);
      const res = solveTwoBone(S, this.wristT, l1, l2, this.poleL, this.elbow, this.wrist, this.hinge);
      this.limb(ix.armL, ix.foreL, S, this.elbow, this.wrist, rig.data.hinges.armL);
      const delta = this.qd.copy(R[ix.foreL]!).invert().multiply(this.handLQ);
      swingTwist(delta, _Y, this.qe, this.qb);
      let twist = 2 * Math.atan2(this.qb.y, this.qb.w);
      if (twist > Math.PI) twist -= 2 * Math.PI;
      else if (twist < -Math.PI) twist += 2 * Math.PI;
      const fingerDir = this.vb.copy(finger).applyQuaternion(this.handLQ);
      const foreDir = this.vd.copy(_Y).applyQuaternion(R[ix.foreL]!);
      const bend = Math.acos(Math.max(-1, Math.min(1, fingerDir.dot(foreDir))));
      this.lastTwistL = twist;
      this.lastBendL = bend;
      this.lastClampedL = res.clamped;
      const over = Math.max(0, bend - LEFT_ROLL.bendOk) / LEFT_ROLL.bendScale;
      return (
        (twist / LEFT_ROLL.twistScale) ** 2 + over * over + LEFT_ROLL.reg * (psi / (Math.PI / 2)) ** 2 + (res.clamped ? LEFT_ROLL.clampPenalty : 0)
      );
    };
    // 指定があればそれを使う。無ければ、粗く走査して最良の周りを黄金分割で詰める（ψ の跳びは焼き込み側が変化量の制限で均す）
    let psi = inpRoll ?? 0;
    if (inpRoll === undefined) {
      const { max, coarse } = LEFT_ROLL;
      let best = 0;
      let bestCost = Infinity;
      for (let k = 0; k < coarse; k++) {
        const cand = -max + (2 * max * k) / (coarse - 1);
        const c = attempt(cand);
        if (c < bestCost) {
          bestCost = c;
          best = cand;
        }
      }
      const step = (2 * max) / (coarse - 1);
      let lo = Math.max(-max, best - step);
      let hi = Math.min(max, best + step);
      const g = 0.6180339887;
      let x1 = hi - g * (hi - lo);
      let x2 = lo + g * (hi - lo);
      let f1 = attempt(x1);
      let f2 = attempt(x2);
      for (let i = 0; i < LEFT_ROLL.refineIters; i++) {
        if (f1 < f2) {
          hi = x2;
          x2 = x1;
          f2 = f1;
          x1 = hi - g * (hi - lo);
          f1 = attempt(x1);
        } else {
          lo = x1;
          x1 = x2;
          f1 = f2;
          x2 = lo + g * (hi - lo);
          f2 = attempt(x2);
        }
      }
      psi = (lo + hi) / 2;
    }
    attempt(psi); // 最終の値で R・肘・手首・診断値を確定する
    const info2 = info;
    info2.armLClamped = this.lastClampedL;
    info2.wristBendL = this.lastBendL;
    info2.wristTwistL = this.lastTwistL;
    info2.rollL = psi;
    P[ix.foreL]!.copy(this.elbow);
    P[ix.handL]!.copy(this.wrist);
    // 前腕のねじれを肘と手首で分ける
    const delta = this.qd.copy(R[ix.foreL]!).invert().multiply(this.handLQ);
    swingTwist(delta, _Y, this.qe, this.qc);
    this.qc.slerp(IDENTITY, 1 - FOREARM_TWIST_SHARE);
    R[ix.foreL]!.multiply(this.qc);
    R[ix.handL]!.copy(this.handLQ);
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
