import { describe, expect, it } from 'vitest';
import { formatTime } from './hud';

describe('formatTime', () => {
  it('秒を m:ss.s に整える', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(5.04)).toBe('0:05.0');
    expect(formatTime(83.4)).toBe('1:23.4');
    expect(formatTime(600)).toBe('10:00.0');
  });

  it('0.1 秒に丸めたとき分が繰り上がる（59.96 → 1:00.0）', () => {
    expect(formatTime(59.96)).toBe('1:00.0');
    expect(formatTime(59.94)).toBe('0:59.9');
    expect(formatTime(119.99)).toBe('2:00.0');
  });

  it('負の値は 0 として扱う', () => {
    expect(formatTime(-3)).toBe('0:00.0');
  });
});
