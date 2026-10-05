import { LOCKON } from './data/lockon';
import { lockStillValid, pickTarget, switchTarget, type LockCandidate } from './lockon';

/**
 * ロックオンの状態（純粋ロジック。Game が毎 sim ステップ update を呼ぶ）。
 *
 *  - ロックボタン: ロック中なら解除、そうでなければ最寄り（画面の正面寄り）の敵をロック。対象がいなければ何も起きない
 *  - 切替（横スワイプ・Q/E）: ロック中だけ。連続しないよう switchCooldownFrames の間隔を空ける
 *  - 対象が倒れたら、残っている敵の中から自動で次の対象に移る（いなければ解除）。breakRange を超えて離れたら解除
 *  - 見えない敵（柱などに遮られている。LockCandidate.visible = false）は選べず、切替先にもならない。ロック中の対象が hiddenBreakFrames を超えて見えなければ、見える別の敵へ移る（いなければ解除。M7-4b）
 */

export type LockEvent = 'lock' | 'unlock' | 'switch';

export interface LockUpdate {
  /** ロックボタンが押された（このステップ） */
  pressed: boolean;
  /** 切替の向き: +1 右、−1 左、0 なし */
  switchDir: number;
  px: number;
  pz: number;
  camYaw: number;
  /** ロックできる敵（生きているものだけ） */
  cands: readonly LockCandidate[];
}

export class LockOn {
  targetId: number | null = null;
  private cooldown = 0;
  /** ロック中の対象が、遮られて見えない状態が続いているフレーム数（見えたら 0。M7-4b） */
  private hidden = 0;

  get locked(): boolean {
    return this.targetId !== null;
  }

  /** 状態が変わったら種類を返す（効果音・見た目用） */
  update(u: LockUpdate): LockEvent | null {
    if (this.cooldown > 0) this.cooldown--;
    let event: LockEvent | null = null;

    if (u.pressed) {
      if (this.targetId !== null) {
        this.release();
        return 'unlock';
      }
      const id = pickTarget(u.px, u.pz, u.camYaw, u.cands);
      if (id !== null) {
        this.targetId = id;
        this.cooldown = 0;
        this.hidden = 0;
        event = 'lock';
      }
      return event;
    }

    if (this.targetId !== null) {
      const cur = u.cands.find((c) => c.id === this.targetId);
      if (!cur) {
        // 倒れた（候補から消えた）: 残りの敵へ自動で移る
        const next = pickTarget(u.px, u.pz, u.camYaw, u.cands);
        if (next === null) {
          this.release();
          return 'unlock';
        }
        this.targetId = next;
        this.hidden = 0;
        event = 'switch';
      } else if (!lockStillValid(u.px, u.pz, cur)) {
        this.release();
        return 'unlock';
      } else if (cur.visible === false) {
        // 柱などに遮られて見えない: しばらくは保つ（回り込む・ちょっと隠れるだけでは外れない）。続いたら、見える別の敵へ移るか、解く
        if (++this.hidden > LOCKON.hiddenBreakFrames) {
          const next = pickTarget(u.px, u.pz, u.camYaw, u.cands);
          this.hidden = 0;
          if (next === null) {
            this.release();
            return 'unlock';
          }
          this.targetId = next;
          event = 'switch';
        }
      } else {
        this.hidden = 0;
      }
    }

    if (this.targetId !== null && u.switchDir !== 0 && this.cooldown <= 0) {
      const next = switchTarget(this.targetId, u.switchDir > 0 ? 1 : -1, u.px, u.pz, u.cands);
      if (next !== this.targetId) {
        this.targetId = next;
        this.hidden = 0;
        this.cooldown = LOCKON.switchCooldownFrames;
        event = 'switch';
      }
    }
    return event;
  }

  release(): void {
    this.targetId = null;
    this.cooldown = 0;
    this.hidden = 0;
  }
}
