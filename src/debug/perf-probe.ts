import * as THREE from 'three';
import type { Game } from '../game/game';
import type { SceneFormat } from '../render/post';

/**
 * 実機（iPad Safari）で fps の原因を切り分ける計測モード。URL に `?perf=1` を付けると有効になる。
 *
 * ヘッドレス Chromium（SwiftShader）では GPU の時間が測れないので、実機の上で「機能を 1 つずつ止めたときに
 * フレーム時間がどれだけ縮むか」を測る。各設定について
 *   1. 20 フレーム 慣らし（シェーダのコンパイルやバッファ再確保を済ませる）
 *   2. 60 フレーム 通常どおり回し、rAF 間隔から fps と p95 を出す
 *   3. 40 フレーム 描画のあとに 1 ピクセルを readPixels して GPU の完了を待ち、
 *      JS の時間（描画命令の発行まで）と GPU の待ち時間を分けて測る
 * を行い、元に戻して次へ進む。最後に基準をもう一度測る（発熱で遅くなっていないかの確認）。
 *
 * Safari の WebGL は EXT_disjoint_timer_query を持たないため、GPU 時間は readPixels の待ちで近似する。
 * 「gpu 待ち」は フレーム全体(total) − JS が命令を出し終えるまで(js) で、CPU と GPU が重なる分は含まれない近似値。
 * ポスト構成を軽くした後（ADR-011）の確認用に、MSAA・ブルーム・シーン精度の切り替えも同じ表に並べる。
 * 通常起動では読み込まれない（main.ts が動的 import する）。
 */

// perfFast=1 は動作確認用（ヘッドレスなど遅い環境で表の形だけ確かめる）。数値は信用しない
const FAST = new URLSearchParams(location.search).has('perfFast');
const WARM = FAST ? 2 : 20;
const FREE = FAST ? 4 : 60;
const SYNC = FAST ? 3 : 40;

interface Config {
  label: string;
  /** 結果の表に出さない（最初のシェーダコンパイル等を済ませるための慣らし） */
  hidden?: boolean;
  /** 設定を適用し、元に戻す関数を返す */
  apply: () => () => void;
}

interface Result {
  label: string;
  fps: number;
  p95: number;
  js: number;
  total: number;
  calls: number;
  tris: number;
}

type Phase = 'warm' | 'free' | 'sync';

const NOOP = (): void => {};

function mean(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}
function percentile(a: number[], p: number): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
}

export function installPerfProbe(game: Game): void {
  // 計測中に動的解像度が pixelRatio を動かすと比較にならないので止める（起動時の段で固定される）
  game.adaptive.lock();
  const renderer = game.host.renderer;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const post = game.post;
  const px = new Uint8Array(4);

  // ---------- 設定の部品 ----------
  const setPostRender = (fn: () => void): (() => void) => {
    const orig = post.render.bind(post);
    post.render = fn;
    return () => {
      post.render = orig;
    };
  };
  const setProp = <T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): (() => void) => {
    const prev = obj[key];
    obj[key] = value;
    return () => {
      obj[key] = prev;
    };
  };
  const setVisible = (objs: THREE.Object3D[], v: boolean): (() => void) => {
    const prev = objs.map((o) => o.visible);
    for (const o of objs) o.visible = v;
    return () => objs.forEach((o, i) => (o.visible = prev[i] ?? true));
  };
  /** シーン用ターゲットのサンプル数・精度を変える。元に戻す関数を返す */
  const setScene = (opts: { samples?: number; format?: SceneFormat }): (() => void) => {
    const prevSamples = post.sceneSamples;
    const prevFormat = post.sceneFormat;
    post.setSceneTarget(opts);
    return () => post.setSceneTarget({ samples: prevSamples, format: prevFormat });
  };
  /** R11F_G11F_B10F が MSAA 付きで描けるか（端末による）。描けない端末ではその行を測らない */
  const canR11 = ((): boolean => {
    if (!gl.getExtension('EXT_color_buffer_float')) return false;
    const fb = gl.createFramebuffer();
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.R11F_G11F_B10F, 64, 64);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteRenderbuffer(rb);
    return ok;
  })();
  const stack = (...fns: Array<() => () => void>): (() => void) => {
    const undo = fns.map((f) => f());
    return () => undo.reverse().forEach((u) => u());
  };
  const findOutlines = (): THREE.Object3D[] => {
    const list: THREE.Object3D[] = [];
    game.scene.traverse((o) => {
      if (o.name.endsWith('__outline')) list.push(o);
    });
    return list;
  };
  const sun = (): THREE.DirectionalLight | null => {
    let found: THREE.DirectionalLight | null = null;
    game.scene.traverse((o) => {
      if ((o as THREE.DirectionalLight).isDirectionalLight) found = o as THREE.DirectionalLight;
    });
    return found;
  };
  const setShadowMapSize = (size: number): (() => void) => {
    const light = sun();
    if (!light) return NOOP;
    const prev = light.shadow.mapSize.x;
    const resize = (s: number) => {
      light.shadow.mapSize.set(s, s);
      light.shadow.map?.dispose();
      light.shadow.map = null;
    };
    resize(size);
    return () => resize(prev);
  };
  const setDpr = (v: number): (() => void) => {
    const prev = game.host.maxRatio;
    game.host.setMaxPixelRatio(v);
    return () => game.host.setMaxPixelRatio(prev);
  };
  const addStyle = (css: string): (() => void) => {
    const el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
    return () => el.remove();
  };
  const direct = (): (() => void) =>
    setPostRender(() => {
      renderer.setRenderTarget(null);
      renderer.render(game.scene, game.cam.camera);
    });

  // 現行のポスト構成: シーン → sceneRT（MSAA・RGBA8）→ ブルーム（半解像度）→ 最終 1 パス（画面へ）
  const configs: Config[] = [
    { label: '慣らし', hidden: true, apply: () => NOOP },
    { label: '基準（現状）', apply: () => NOOP },
    { label: '描画なし（JS・rAF だけ）', apply: () => setPostRender(NOOP) },
    { label: 'ポスト全部なし（直描き）', apply: direct },
    { label: 'ブルーム切', apply: () => setProp(post, 'bloomEnabled', false) },
    { label: 'ブルーム 1/4 解像度', apply: () => { post.setBloomScale(0.25); return () => post.setBloomScale(0.5); } },
    { label: 'MSAA 切', apply: () => setScene({ samples: 0 }) },
    { label: 'MSAA 2 倍', apply: () => setScene({ samples: 2 }) },
    {
      label: canR11 ? 'シーン R11G11B10（HDR・4byte）' : 'シーン R11G11B10（この端末は非対応）',
      apply: () => (canR11 ? setScene({ format: 'r11g11b10' }) : NOOP),
    },
    { label: 'シーン RGBA8（ブルームが弱くなる）', apply: () => setScene({ format: 'rgba8' }) },
    { label: '影パス切', apply: () => { const l = sun(); return l ? setProp(l, 'castShadow', false) : NOOP; } },
    { label: '影マップ 1024', apply: () => setShadowMapSize(1024) },
    { label: '輪郭線切', apply: () => setVisible(findOutlines(), false) },
    { label: '空切', apply: () => setVisible([game.sky.mesh], false) },
    { label: 'キャラ切', apply: () => setVisible([game.player.root], false) },
    { label: '舞台切', apply: () => setVisible([game.arena.group], false) },
    { label: '解像度 dpr 1.0', apply: () => setDpr(1.0) },
    { label: '解像度 dpr 1.25', apply: () => setDpr(1.25) },
    { label: '解像度 dpr 2.0', apply: () => setDpr(2.0) },
    { label: 'UI の blur 切', apply: () => addStyle('.tbtn{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}') },
    { label: 'UI 全部非表示', apply: () => addStyle('#touch-layer,#hud{display:none!important}') },
    {
      label: '軽量案: ブルーム切+影1024',
      apply: () => stack(() => setProp(post, 'bloomEnabled', false), () => setShadowMapSize(1024)),
    },
    { label: '基準（再）', apply: () => NOOP },
  ];

  // ---------- 計測の状態機械 ----------
  const results: Result[] = [];
  let running = false;
  let index = 0;
  let phase: Phase = 'warm';
  let count = 0;
  let revert: () => void = NOOP;
  let intervals: number[] = [];
  let jsTimes: number[] = [];
  let totalTimes: number[] = [];
  let calls = 0;
  let tris = 0;

  const startConfig = (): void => {
    const cfg = configs[index];
    if (!cfg) return;
    revert = cfg.apply();
    phase = 'warm';
    count = 0;
    intervals = [];
    jsTimes = [];
    totalTimes = [];
    setStatus(`計測中 ${index + 1}/${configs.length}  ${cfg.label}`);
  };

  const finishConfig = (): void => {
    const cfg = configs[index];
    if (cfg && !cfg.hidden) {
      const avgInterval = mean(intervals);
      results.push({
        label: cfg.label,
        fps: avgInterval > 0 ? 1000 / avgInterval : 0,
        p95: percentile(intervals, 0.95),
        js: mean(jsTimes),
        total: mean(totalTimes),
        calls,
        tris,
      });
    }
    revert();
    revert = NOOP;
    index++;
    if (index >= configs.length) {
      running = false;
      showResults();
    } else {
      startConfig();
    }
  };

  const onFrame = (t0: number, t1: number, t2: number, frameDtSec: number): void => {
    if (!running) return;
    count++;
    if (phase === 'warm') {
      if (count >= WARM) {
        phase = 'free';
        count = 0;
      }
    } else if (phase === 'free') {
      intervals.push(frameDtSec * 1000);
      if (count >= FREE) {
        phase = 'sync';
        count = 0;
      }
    } else {
      jsTimes.push(t1 - t0);
      totalTimes.push(t2 - t0);
      const info = renderer.info.render;
      calls = info.calls;
      tris = info.triangles;
      if (count >= SYNC) finishConfig();
    }
  };

  // Game.render を包む。GameLoop は this.render をその都度呼ぶので、インスタンスのプロパティで差し替えられる
  const g = game as unknown as { render: (alpha: number, frameDt: number) => void };
  const origRender = g.render.bind(game);
  g.render = (alpha: number, frameDt: number): void => {
    const t0 = performance.now();
    origRender(alpha, frameDt);
    const t1 = performance.now();
    if (running && phase === 'sync') gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t2 = performance.now();
    onFrame(t0, t1, t2, frameDt);
  };

  // ---------- 表示 ----------
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;left:8px;top:64px;z-index:10000;font:11px/1.4 ui-monospace,Menlo,monospace;color:#fff;' +
    'background:rgba(0,0,0,.84);padding:8px 10px;border-radius:8px;pointer-events:auto;max-width:96vw;max-height:88vh;overflow:auto;';
  const head = document.createElement('pre');
  head.style.cssText = 'margin:0;font:inherit;white-space:pre-wrap;';
  const tableHost = document.createElement('div');
  const tail = document.createElement('pre');
  tail.style.cssText = 'margin:6px 0 0;font:inherit;white-space:pre-wrap;color:#cde;';
  const buttons = document.createElement('div');
  buttons.style.cssText = 'margin-top:8px;display:flex;gap:8px;';
  const mkButton = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:inherit;font-size:13px;padding:8px 14px;border-radius:6px;border:1px solid #fff8;background:#234;color:#fff;';
    b.addEventListener('click', onClick);
    return b;
  };
  const startBtn = mkButton('計測開始（約 1.5 分・触らず待つ）', () => start());
  const closeBtn = mkButton('閉じる', () => panel.remove());
  buttons.append(startBtn, closeBtn);
  panel.append(head, tableHost, tail, buttons);
  document.body.appendChild(panel);

  const envLines = (): string => {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    return (
      `GPU ${gpu}  three r${THREE.REVISION}\n` +
      `画面 ${window.innerWidth}x${window.innerHeight} dpr ${window.devicePixelRatio} → 描画 ${size.x}x${size.y}（上限 ${game.host.pixelRatio.toFixed(2)}）  maxSamples ${renderer.capabilities.maxSamples}`
    );
  };

  const setStatus = (s: string): void => {
    // 計測中は表示を最小にする（DOM の更新が計測に混ざらないように）
    head.textContent = running ? s : `${envLines()}\n${s}`;
    tableHost.replaceChildren();
    tail.textContent = '';
  };

  const frameMs = (r: Result): number => (r.fps > 0 ? 1000 / r.fps : 0);

  const showResults = (): void => {
    const base = results[0];
    const refresh = results[1] ? `rAF 間隔（描画なし）${frameMs(results[1]).toFixed(1)}ms ≒ ${results[1].fps.toFixed(0)}Hz` : '';
    head.textContent = `${envLines()}\n${refresh}`;

    const table = document.createElement('table');
    table.style.cssText = 'border-collapse:collapse;margin-top:6px;';
    const addRow = (cells: string[], color?: string, bold?: boolean): void => {
      const tr = document.createElement('tr');
      cells.forEach((c, i) => {
        const td = document.createElement('td');
        td.textContent = c;
        td.style.cssText = `padding:1px 7px;text-align:${i === 0 ? 'left' : 'right'};white-space:nowrap;${color ? `color:${color};` : ''}${bold ? 'font-weight:700;' : ''}`;
        tr.appendChild(td);
      });
      table.appendChild(tr);
    };
    addRow(['設定', 'fps', 'frame', 'p95', 'js', 'gpu待', '計', 'calls', 'tris'], '#9bd', true);
    // 色と順位は「計」(js+gpu待。vsync や rAF の周期に左右されない)で付ける。fps・frame は実際の通しの速さ
    const baseTotal = base ? base.total : 0;
    results.forEach((r, i) => {
      const ms = frameMs(r);
      // 基準より 10% 以上速いと緑、遅いと赤
      const color = i === 0 || i === results.length - 1 ? '#fff' : base && r.total < baseTotal * 0.9 ? '#8f8' : base && r.total > baseTotal * 1.1 ? '#f99' : undefined;
      addRow(
        [r.label, r.fps.toFixed(1), ms.toFixed(1), r.p95.toFixed(1), r.js.toFixed(1), Math.max(0, r.total - r.js).toFixed(1), r.total.toFixed(1), String(r.calls), `${(r.tris / 1000).toFixed(0)}k`],
        color,
        i === 0 || i === results.length - 1,
      );
    });
    tableHost.replaceChildren(table);

    // 基準（現状）よりフレーム時間が何 ms 縮んだか、の大きい順（「描画なし」と「基準（再）」は除く）
    const gains = base
      ? results
          .slice(1, -1)
          .filter((r) => !r.label.startsWith('描画なし'))
          .map((r) => ({ label: r.label, gain: baseTotal - r.total }))
          .sort((a, b) => b.gain - a.gain)
          .slice(0, 6)
      : [];
    tail.textContent =
      `1 フレームの計が縮んだ順（基準 ${baseTotal.toFixed(1)}ms から）:\n${gains.map((x) => `  ${x.label}  ${x.gain >= 0 ? '−' : '+'}${Math.abs(x.gain).toFixed(1)} ms`).join('\n')}\n\n` +
      'frame=平均フレーム間隔(ms)  p95=遅い方 5% の間隔  js=描画命令を出し終えるまで(ms)\n' +
      'gpu待=readPixels で GPU の完了を待った分(ms)  計=js+gpu待。基準→基準（再）で計が伸びていたら発熱で遅くなっている';
    startBtn.textContent = 'もう一度';
    startBtn.style.display = '';
    closeBtn.style.display = '';
    console.table(results);
    (window as unknown as { __perfResults?: Result[] }).__perfResults = results;
  };

  const start = (): void => {
    if (running) return;
    game.hud.hideStart();
    if (!game.loop.isRunning && game.ready) game.start();
    results.length = 0;
    index = 0;
    running = true;
    startBtn.style.display = 'none';
    closeBtn.style.display = 'none';
    startConfig();
  };

  setStatus('準備完了。「計測開始」を押すと、画面を触らずに待つだけで表が出ます');
  // キーボードでも開始できる（デスクトップでの動作確認用）
  window.addEventListener('keydown', (e) => {
    if (e.key === 'p' && !running) start();
  });
}
