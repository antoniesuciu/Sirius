import { type LogoState, SiriusLogo } from '../../../packages/ui/src/SiriusLogo.tsx';
import { playground } from './harness.tsx';

playground<LogoState>({
  title: 'Logo',
  intro: 'Nine states, ported from the motion spec (playground.html), in the brand gradient.',
  initial: 'startup',
  after: 'idle',
  states: [
    { id: 'startup', label: 'Startup', note: 'The crescent draws itself, the wolf fades up, the star ignites.' },
    { id: 'idle', label: 'Idle', note: 'Blinks; with ambient on, a twinkle, breathing and moonlight.' },
    { id: 'listening', label: 'Listening', note: 'The far ear pricks forward; the star drifts to the nose.' },
    { id: 'thinking', label: 'Thinking', note: 'Canis Major drawn one star at a time.' },
    { id: 'working', label: 'Working', note: 'The shape holds still while the light moves.' },
    { id: 'speaking', label: 'Speaking', note: 'The star follows the voice: 30 ms attack, 150 ms release.' },
    { id: 'notify', label: 'Notify', note: 'A short howl and one ripple, then idle.' },
    { id: 'error', label: 'Error', note: 'The star flickers out and relights, then idle.' },
    { id: 'sleep', label: 'Sleep', note: 'The eye closes; the star drifts out and dims.' },
  ],
  extras: {
    ambient: { label: 'Ambient idle', on: true },
    demo: { label: 'Demo blink timing (3.5–7 s)', on: true },
    ink: { label: 'Ink', on: false },
  },
  render: ({ state, size, level, settle, extras }) => (
    <SiriusLogo
      state={state}
      size={size}
      level={level}
      ambient={extras.ambient}
      blinkEvery={extras.demo ? [3.5, 7] : [20, 40]}
      ink={extras.ink}
      onSettled={settle}
    />
  ),
});
