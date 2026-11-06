/**
 * The Sirius wolf from the layered logo (docs/design/sirius-logo). Still for now: the
 * animated states are web-only (GSAP), and porting them to Reanimated is its own step.
 */
import Svg, { Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { ORBIT } from '../../../packages/ui/src/avatar/orbit.gen.ts';
import type { Colors } from './theme.ts';

export function Logo({ size, colors }: { size: number; colors: Colors }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" accessibilityLabel="Sirius">
      <Defs>
        <LinearGradient id="ink" gradientUnits="userSpaceOnUse" x1="213" y1="75" x2="215" y2="458">
          <Stop offset="0" stopColor={colors.sirius1} />
          <Stop offset="1" stopColor={colors.sirius2} />
        </LinearGradient>
      </Defs>
      <G fill="url(#ink)" fillRule="evenodd">
        <Path d={ORBIT.head} />
        <Path d={ORBIT.earBack} />
        <Path d={ORBIT.eye} />
        <Path d={ORBIT.ring} />
        <Path d={ORBIT.star} />
      </G>
    </Svg>
  );
}
