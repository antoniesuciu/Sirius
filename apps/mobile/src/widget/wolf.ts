/** The still wolf as an SVG string, for SvgWidget: home-screen widgets cannot run react-native-svg. */
import { ORBIT } from '../../../../packages/ui/src/avatar/orbit.gen.ts';
import type { Colors } from '../theme.ts';

const PATHS = [ORBIT.head, ORBIT.earBack, ORBIT.eye, ORBIT.ring, ORBIT.star]
  .map((d) => `<path d="${d}"/>`)
  .join('');

export function wolfSvg(colors: Colors): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="213" y1="75" x2="215" y2="458"><stop offset="0" stop-color="${colors.sirius1}"/><stop offset="1" stop-color="${colors.sirius2}"/></linearGradient></defs><g fill="url(#g)" fill-rule="evenodd">${PATHS}</g></svg>`;
}
