/**
 * セーブの置き場（localStorage）。Safari のプライベートブラウズは localStorage が例外を投げる・容量が 0 のことがあり、
 * ストレージを無効にしている端末もあるので、読み書きは必ず try/catch で包み、使えないときは「セーブなし」で動く（ゲームは止めない）。
 * データの形・版・移行は src/combat/save.ts（純粋）。ここは入れ物だけ。
 */

const SAVE_KEY = 'mw.save';

/** 保存したものを読む（JSON）。無い・壊れている・使えないときは null */
export function readSave(): unknown {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    return text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

/** 保存する。できたら true（使えない・容量切れなら false。呼ぶ側は気にせず続けてよい） */
export function writeSave(data: unknown): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** セーブを消す（「最初から」）。できたら true */
export function clearSave(): boolean {
  try {
    localStorage.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}
