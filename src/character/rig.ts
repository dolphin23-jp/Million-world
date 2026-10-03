import { Quaternion, Vector3 } from 'three';

/**
 * 手付けアニメ用のリグ情報。THREE のシーングラフには依存せず、骨の親子・長さ・基準ポーズ（idle の t=0）・
 * 肘膝の蝶番軸だけを持つ純粋なデータ（シーンからの読み取りは rig-capture.ts）。
 * 単位はメートル。キャラは +Z を向き、右手側が −X（Armature は identity で、GLB の cm は呼び出し側で 0.01 倍する）。
 */

/** このリグ（Meshy の人型）の骨名。親から子の順 */
export const BONE = {
  hips: 'Hips',
  spine02: 'Spine02',
  spine01: 'Spine01',
  spine: 'Spine',
  neck: 'neck',
  head: 'Head',
  shoulderR: 'RightShoulder',
  armR: 'RightArm',
  foreR: 'RightForeArm',
  handR: 'RightHand',
  shoulderL: 'LeftShoulder',
  armL: 'LeftArm',
  foreL: 'LeftForeArm',
  handL: 'LeftHand',
  upLegR: 'RightUpLeg',
  legR: 'RightLeg',
  footR: 'RightFoot',
  toeR: 'RightToeBase',
  upLegL: 'LeftUpLeg',
  legL: 'LeftLeg',
  footL: 'LeftFoot',
  toeL: 'LeftToeBase',
} as const;

export interface BoneDesc {
  name: string;
  parent: string | null;
  /** 親のローカル空間での位置（m） */
  pos: Vector3;
  /** idle の t=0 での、親のローカル空間の回転 */
  idleQuat: Quaternion;
}

/** 蝶番軸（骨のローカル空間）。u = 上腕・太腿、f = 前腕・脛 */
export interface HingeAxes {
  u: Vector3;
  f: Vector3;
}

export interface RigData {
  bones: BoneDesc[];
  /** idle の t=0 での Hips の位置（m。キャラ基準） */
  hipsPos: Vector3;
  hinges: { armR: HingeAxes; armL: HingeAxes; legR: HingeAxes; legL: HingeAxes };
  /** 剣のグリップ: 手ボーンのローカルでの柄の位置（m）と、剣のローカル → 手ボーンのローカルの回転 */
  grip: { pos: Vector3; quat: Quaternion };
  /** 右手の指が向く方向（手ボーンのローカル、単位ベクトル）。手首の曲がりの診断に使う（手ボーンの Y 軸は指の向きから約 22° ずれている）。省略時は +Y */
  handFinger?: Vector3;
  /** 資産の長さ単位 → m の倍率（GLB の Armature が cm を 0.01 倍で見せているので既定は 0.01）。クリップの位置トラックの換算に使う */
  unit?: number;
}

/** Rig に含めない骨（head_end など）。ポーズ計算の対象外だが、クリップに定数トラックを入れて idle の姿勢に固定する */
export interface ExtraBone {
  name: string;
  quat: Quaternion;
}

export class Rig {
  readonly data: RigData;
  /** 資産の長さ単位 → m（クリップの位置トラック = m ÷ unit） */
  readonly unit: number;
  readonly names: string[];
  readonly index = new Map<string, number>();
  readonly parent: number[];
  readonly pos: Vector3[];
  readonly idleLocal: Quaternion[];
  /** idle の t=0 での世界回転・世界位置（キャラ基準） */
  readonly idleWorldQ: Quaternion[];
  readonly idleWorldP: Vector3[];

  constructor(data: RigData) {
    this.data = data;
    this.unit = data.unit ?? 0.01;
    this.names = data.bones.map((b) => b.name);
    this.names.forEach((n, i) => this.index.set(n, i));
    this.parent = data.bones.map((b) => (b.parent === null ? -1 : this.mustIndex(b.parent)));
    // 親が子より先にあること
    this.parent.forEach((p, i) => {
      if (p >= i) throw new Error(`骨の並びが親→子ではありません: ${this.names[i]}`);
    });
    this.pos = data.bones.map((b) => b.pos.clone());
    this.idleLocal = data.bones.map((b) => b.idleQuat.clone());
    this.idleWorldQ = [];
    this.idleWorldP = [];
    for (let i = 0; i < this.names.length; i++) {
      const p = this.parent[i]!;
      if (p < 0) {
        this.idleWorldQ.push(this.idleLocal[i]!.clone());
        this.idleWorldP.push(data.hipsPos.clone());
      } else {
        this.idleWorldQ.push(this.idleWorldQ[p]!.clone().multiply(this.idleLocal[i]!));
        this.idleWorldP.push(this.idleWorldP[p]!.clone().add(this.pos[i]!.clone().applyQuaternion(this.idleWorldQ[p]!)));
      }
    }
  }

  /**
   * 親ローカルの回転列から、各骨の世界回転・世界位置（キャラ基準、m）を求める。
   * hipsPos は Hips の位置（m）。出力配列は rig.names と同じ並びで、長さは呼び出し側が用意する
   */
  fk(local: readonly Quaternion[], hipsPos: Vector3, outQ: Quaternion[], outP: Vector3[]): void {
    for (let i = 0; i < this.names.length; i++) {
      const p = this.parent[i]!;
      if (p < 0) {
        outQ[i]!.copy(local[i]!);
        outP[i]!.copy(hipsPos);
      } else {
        outQ[i]!.copy(outQ[p]!).multiply(local[i]!);
        outP[i]!.copy(this.pos[i]!).applyQuaternion(outQ[p]!).add(outP[p]!);
      }
    }
  }

  mustIndex(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`リグに骨がありません: ${name}`);
    return i;
  }

  /** 骨 name の子の位置（＝この骨の長さ）。子が 1 つ以上ある骨用 */
  length(name: string, child: string): number {
    const c = this.mustIndex(child);
    if (this.parent[c] !== this.mustIndex(name)) throw new Error(`${child} は ${name} の子ではありません`);
    return this.pos[c]!.length();
  }
}
