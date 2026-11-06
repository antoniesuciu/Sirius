import { useSettings } from '@sirius/client';
import { type ThemeId, themeFrom } from '@sirius/contracts';
import { THEME_COLORS } from './theme.gen.ts';

export type Colors = (typeof THEME_COLORS)[ThemeId];

/** The theme chosen on the laptop (F40), so the phone follows it, as the web app does. */
export function useColors(): Colors {
  return THEME_COLORS[themeFrom(useSettings().data)];
}

export const SERIF = 'serif';

/** For the status bar: dark icons on a light ground. */
export function isLight(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}
