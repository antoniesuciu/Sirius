import type { AvatarState } from '../../../packages/ui/src/SiriusAvatar.tsx';
import { SiriusMark } from '../../../packages/ui/src/SiriusMark.tsx';
import { playground } from './harness.tsx';

playground<AvatarState>({
  title: 'Mark',
  intro: 'Five states in the theme’s own colours. Idle and asleep are one still frame.',
  initial: 'idle',
  after: 'idle',
  states: [
    { id: 'idle', label: 'Idle', note: 'Still: nothing runs, so the window stops redrawing.' },
    { id: 'listening', label: 'Listening', note: 'The head tilts to listen; the star breathes.' },
    { id: 'thinking', label: 'Thinking', note: 'A light runs round the orbit; the star draws in.' },
    { id: 'speaking', label: 'Speaking', note: 'A small nod; the star follows the voice.' },
    { id: 'asleep', label: 'Asleep', note: 'Quiet mode: dimmed and still.' },
  ],
  render: ({ state, size, level }) => <SiriusMark state={state} size={size} level={level} />,
});
