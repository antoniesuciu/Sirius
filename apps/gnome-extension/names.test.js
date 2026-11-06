import { expect, test } from 'vitest';
import { names } from './sirius-focus@sirius/names.js';

// Real titles from this laptop, 2026-11-06 (ADR 0015).
test('a title names the folder only as the last part of a path', () => {
  const terminal = 'antonie-suciu@aparate:~/Documents';
  const nested = 'antonie-suciu@aparate:~/Documents/sirius';
  const vscode =
    'REPORT.pdf - ros2_ws [Container ubuntu:22.04 (humble-box)] - themes - Visual Studio Code';
  expect(names(terminal, 'Documents')).toBe(true);
  expect(names(nested, 'Documents')).toBe(false);
  expect(names(nested, 'sirius')).toBe(true);
  expect(names(vscode, 'ros2_ws')).toBe(true);
  expect(names(vscode, 'ws')).toBe(false);
  expect(names('.gitmodules - sirius - themes - Visual Studio Code', 'sirius')).toBe(true);
  expect(names('x - my.app (1) - Visual Studio Code', 'my.app (1)')).toBe(true);
});
