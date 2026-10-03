#!/usr/bin/env node
/**
 * 効果音を OfflineAudioContext で書き出して数値検査し、WAV を artifacts/audio/ に出す（聴いて確かめる用）。
 *
 *   npm run build && node tools/sfx-check.mjs
 *
 * 検査: ピーク（クリップしていないか・小さすぎないか）、実効値、鳴っている長さ、終わりが静かか（尻切れのプチ音）、直流成分。
 * 耳で聴いての良し悪し（質感・音程）は見られない。数値は「壊れていない」の確認まで。
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch { return require(`${execSync('npm root -g').toString().trim()}/playwright`); }
}

const port = 4196;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: true });
const url = `http://127.0.0.1:${port}/?autostart=1&adaptive=0&sfxlab=1&mute=1`;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try { if ((await fetch(url)).ok) break; } catch {}
}

/** 16bit PCM モノラルの WAV */
function wav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.__mw?.sfxLab), null, { timeout: 60000 });
  const names = await page.evaluate(() => window.__mw.sfxLab.names);
  const rate = await page.evaluate(() => window.__mw.sfxLab.sampleRate);
  mkdirSync('artifacts/audio', { recursive: true });
  console.log('name'.padEnd(12), 'peak'.padStart(6), 'rms'.padStart(7), 'len(ms)'.padStart(8), 'tail'.padStart(8), 'dc'.padStart(8));
  for (const name of names) {
    const { samples } = await page.evaluate((n) => window.__mw.sfxLab.render(n), name);
    let peak = 0, sum = 0, dc = 0, last = 0;
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      peak = Math.max(peak, a);
      sum += samples[i] * samples[i];
      dc += samples[i];
      if (a > 0.003) last = i;
    }
    const rms = Math.sqrt(sum / samples.length);
    // 終わりの 10ms の実効値（音が尻切れだとここが大きい = プチ音）
    const tailN = Math.round(rate * 0.01);
    let tail = 0;
    for (let i = samples.length - tailN; i < samples.length; i++) tail += samples[i] * samples[i];
    tail = Math.sqrt(tail / tailN);
    dc /= samples.length;
    const problems = [];
    if (peak < 0.08) problems.push('小さすぎる');
    if (peak > 0.98) problems.push('クリップ');
    if (tail > 0.01) problems.push('尻切れ');
    if (Math.abs(dc) > 0.02) problems.push('直流成分');
    if (last < rate * 0.03) problems.push('短すぎる');
    if (problems.length) failed++;
    console.log(name.padEnd(12), peak.toFixed(2).padStart(6), rms.toFixed(3).padStart(7), String(Math.round((last / rate) * 1000)).padStart(8), tail.toFixed(4).padStart(8), dc.toFixed(4).padStart(8), problems.join(' '));
    writeFileSync(`artifacts/audio/${name}.wav`, wav(samples, rate));
  }
  console.log(failed ? `\n${failed} 件に問題があります` : '\nすべて正常（artifacts/audio/*.wav に書き出しました）');
} finally {
  await browser.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  process.exit(failed ? 2 : 0);
}
