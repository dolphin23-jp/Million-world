import { Quaternion, Vector3, type Object3D } from 'three';

/**
 * 姿勢の補正（前傾）: アニメーションの結果の体幹を、キャラの前（+Z）へ傾ける。
 *
 * 資産の待機（Meshy）は上体が後ろへ反っていて（腰 → 首が約 7° 後ろ。足より頭が後ろ）、手付けの攻撃もこの待機を基準に作ってあるので、
 * 立っているあいだ常に後傾に見える（ADR-024）。攻撃の姿勢は振りの高さ・剣先の床までの距離を詰めてあるので、基準そのものは動かさず、
 * 立っている状態（待機・ガードの構えなど）にだけ、実行時に前傾を重ねる（傾きは状態に応じてなめらかに出し入れする。HeroVisual）。
 *
 * 回す軸はキャラの右向き軸（Armature のローカルの X。Armature は回転なし）で、腰から首までの各骨を傾きの何割かだけ回す（share）。
 * 足は世界の向きのまま（腰の傾きを打ち消す）なので、足の接地はそのまま。胸から上（腕・剣）は剛体で一緒に傾くので、握りや両手持ちの相対位置は変わらない。
 * 頭は傾き切らせず、視線が下を向きすぎないようにする。
 */

/** 骨ごとの、傾き（度）に対する世界の回転量の割合。腰から首までの線の傾きが、与えた傾きにほぼ等しくなる配分 */
export interface PostureShare {
  hips: number;
  spine02: number;
  spine01: number;
  spine: number;
  neck: number;
  head: number;
}

export interface PostureBones {
  hips: Object3D;
  spine02: Object3D;
  spine01: Object3D;
  spine: Object3D;
  neck: Object3D;
  head: Object3D;
  upLegL: Object3D;
  upLegR: Object3D;
}

const X_AXIS = new Vector3(1, 0, 0);
const _w = new Quaternion();
const _r = new Quaternion();
const _c = new Quaternion();
const _l = new Quaternion();

/** 補正する骨の並び: 腰 → 胸の下 → 胸の中 → 胸の上 → 首 → 頭 → 左右の足の付け根。PARENT は親の添字（−1 = Armature。回転なしなので単位回転として扱う） */
const PARENT = [-1, 0, 1, 2, 3, 4, 0, 0] as const;
/** 各骨の share（足の付け根は 0 = 世界の向きのまま） */
const SHARE_KEY = ['hips', 'spine02', 'spine01', 'spine', 'neck', 'head', null, null] as const;

export class PostureTrim {
  private readonly bones: Object3D[];
  /** 補正する前にアニメーションが書いた各骨のローカル回転 */
  private readonly saved: Quaternion[];
  /** 補正する前の、各骨の Armature 基準の世界の回転（親から掛けていく） */
  private readonly world: Quaternion[];
  private applied = false;

  constructor(
    b: PostureBones,
    private readonly share: PostureShare,
  ) {
    this.bones = [b.hips, b.spine02, b.spine01, b.spine, b.neck, b.head, b.upLegL, b.upLegR];
    this.saved = this.bones.map(() => new Quaternion());
    this.world = this.bones.map(() => new Quaternion());
  }

  /**
   * Animator.update の直前に呼ぶ。前回の補正を戻して、アニメーションが書いた値に戻す。
   * three のミキサーは、値が前回から変わらないと骨へ書き直さない（補正の上に補正が重なってしまう）ので、毎回戻してから更新する。
   */
  release(): void {
    if (!this.applied) return;
    for (let i = 0; i < this.bones.length; i++) this.bones[i]!.quaternion.copy(this.saved[i]!);
    this.applied = false;
  }

  /** Animator.update の直後に呼ぶ。leanDeg = 腰から首までを前へ傾ける量（度。負なら後ろへ） */
  apply(leanDeg: number): void {
    const { bones, saved, world, share } = this;
    for (let i = 0; i < bones.length; i++) saved[i]!.copy(bones[i]!.quaternion);
    this.applied = true;
    if (Math.abs(leanDeg) < 1e-3) return;
    const k = (Math.PI / 180) * leanDeg;
    // 補正前の世界の回転（Armature 基準）
    for (let i = 0; i < bones.length; i++) {
      const p = PARENT[i]!;
      if (p < 0) world[i]!.copy(saved[i]!);
      else world[i]!.copy(world[p]!).multiply(saved[i]!);
    }
    // 各骨の目標の世界の回転 = 補正前 × 軸まわりの回転。ローカル = 親の新しい世界⁻¹ × 目標。
    // 親との差の回転 R は X 軸まわりなので、ローカルの補正は (W親⁻¹ · R · W親) · L
    const angle = (i: number): number => {
      const key = SHARE_KEY[i]!;
      return key === null ? 0 : share[key] * k;
    };
    for (let i = 0; i < bones.length; i++) {
      const p = PARENT[i]!;
      _r.setFromAxisAngle(X_AXIS, angle(i) - (p < 0 ? 0 : angle(p)));
      if (p < 0) {
        bones[i]!.quaternion.copy(_r).multiply(saved[i]!);
      } else {
        _w.copy(world[p]!);
        _c.copy(_w).invert().multiply(_r).multiply(_w);
        _l.copy(_c).multiply(saved[i]!);
        bones[i]!.quaternion.copy(_l);
      }
    }
  }
}
