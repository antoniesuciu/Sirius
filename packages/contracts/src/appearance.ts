/**
 * How Sirius looks (F40): a colour theme and a voice animation, both chosen by asking Sirius.
 * The colours themselves live in the UI's tokens.css, one block per theme.
 */
import { z } from 'zod';

export const THEMES = {
  paper: {
    label: 'Paper',
    note: 'Warm cream, serif type, olive accent. The original.',
    ground: '#ebe3d1',
  },
  midnight: {
    label: 'Midnight Blue',
    note: 'Deep blue-black, a strong blue accent, serif type.',
    ground: '#070d1c',
  },
  'night-owl': {
    label: 'Night Owl',
    note: "VS Code's Night Owl palette in the Ubuntu font.",
    ground: '#011627',
  },
  graphite: {
    label: 'Graphite',
    note: 'Neutral dark grey with a gold accent, serif type.',
    ground: '#16171a',
  },
  sage: {
    label: 'Sage',
    note: 'Light green-grey paper with a deep green accent.',
    ground: '#e1e7da',
  },
  ember: { label: 'Ember', note: 'Near-black warm brown with an orange glow.', ground: '#140e0b' },
  orb: {
    label: 'Orb',
    note: 'Pure black, sans type, a blue-to-orange gradient. Made for the glowing voice animations.',
    ground: '#000000',
  },
} as const;

export const ORBS = {
  sirius: { label: 'Sirius', note: 'The Orbit wolf: it tilts to listen and nods as it speaks.' },
  ring: { label: 'Ring', note: 'Lines that circle the edge and swell with the voice.' },
  dot: { label: 'Dot', note: 'A plain circle that pulses. The quietest.' },
} as const;

export type ThemeId = keyof typeof THEMES;
export type OrbStyle = keyof typeof ORBS;
export const ThemeId = z.enum(Object.keys(THEMES) as [ThemeId, ...ThemeId[]]);
export const OrbStyle = z.enum(Object.keys(ORBS) as [OrbStyle, ...OrbStyle[]]);

export const DEFAULT_THEME: ThemeId = 'paper';
export const DEFAULT_ORB: OrbStyle = 'sirius';
export const THEME_SETTING = 'ui.theme';
export const ORB_SETTING = 'ui.orb';

/** Reads the stored choice, falling back for a missing or retired value. */
export function themeFrom(settings: Record<string, unknown> | undefined): ThemeId {
  const value = settings?.[THEME_SETTING];
  return typeof value === 'string' && value in THEMES ? (value as ThemeId) : DEFAULT_THEME;
}

/** The theme's background, for what paints before the CSS: the phone's splash (manifest). */
export function groundFrom(settings: Record<string, unknown> | undefined): string {
  return THEMES[themeFrom(settings)].ground;
}

export function orbFrom(settings: Record<string, unknown> | undefined): OrbStyle {
  const value = settings?.[ORB_SETTING];
  return typeof value === 'string' && value in ORBS ? (value as OrbStyle) : DEFAULT_ORB;
}
