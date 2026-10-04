/** DOM を組み立てる小さな道具（メニューの各タブが使う。React 等は入れない。CLAUDE.md） */

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** textContent が違うときだけ書き換える（毎フレーム・毎回の更新でも DOM を無駄に触らない） */
export function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

/**
 * ボタンの押下。押した瞬間に fn を呼び、押し続けると連打になる（iPad の画面でポイントを何十も振るときの手間を減らす）。
 * fn が false を返したら、連打を止める（上限・ポイント切れ）。pointerdown で受ける（iOS のタップは click より早く確実。他のボタンと同じ）
 */
export function onPress(el: HTMLElement, fn: () => boolean | void, opts: { repeat?: boolean; delayMs?: number; intervalMs?: number } = {}): void {
  const { repeat = true, delayMs = 380, intervalMs = 110 } = opts;
  let timer = 0;
  let interval = 0;
  const stop = () => {
    window.clearTimeout(timer);
    window.clearInterval(interval);
    timer = 0;
    interval = 0;
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if ((el as HTMLButtonElement).disabled) return;
    el.setPointerCapture?.(e.pointerId);
    stop();
    if (fn() === false || !repeat) return;
    timer = window.setTimeout(() => {
      interval = window.setInterval(() => {
        if (fn() === false) stop();
      }, intervalMs);
    }, delayMs);
  });
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('lostpointercapture', stop);
}
