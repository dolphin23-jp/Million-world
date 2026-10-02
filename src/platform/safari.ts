/**
 * iPad Safari 向けの既定動作抑止（ADR-001 の代償への対処）。
 * CSS の touch-action だけでは抑えきれないもの（ピンチ、ダブルタップ拡大、長押しメニュー）を JS で止める。
 */
export function installGestureGuards(): void {
  const prevent = (e: Event) => e.preventDefault();
  // ピンチ拡大（Safari 独自イベント）
  document.addEventListener('gesturestart', prevent, { passive: false });
  document.addEventListener('gesturechange', prevent, { passive: false });
  // スクロール・バウンス
  document.addEventListener('touchmove', prevent, { passive: false });
  // ダブルタップ拡大
  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = performance.now();
      if (now - lastTouchEnd < 350) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false },
  );
  // 長押しメニュー・右クリック
  document.addEventListener('contextmenu', prevent);
  // 画面がスリープ/タブ切替から戻ったとき用のフック（loop 側で購読する）
}

/** タブ非表示・復帰の購読。戻り値は解除関数 */
export function onVisibility(cb: (visible: boolean) => void): () => void {
  const handler = () => cb(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', handler);
  window.addEventListener('pagehide', () => cb(false));
  window.addEventListener('pageshow', () => cb(true));
  return () => document.removeEventListener('visibilitychange', handler);
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ は Macintosh を名乗るので maxTouchPoints で判定
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
