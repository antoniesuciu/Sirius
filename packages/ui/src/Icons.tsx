/** Small stroke icons from the mockup. All decorative: their buttons carry the label. */

interface StrokeProps {
  size: number;
  stroke: string;
  width: number;
  d: string;
}

function Stroke({ size, stroke, width, d }: StrokeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      // A style, not the attribute: CSS variables work there, so icons follow the theme.
      style={{ stroke }}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export const CheckIcon = ({ size, stroke }: { size: number; stroke: string }) => (
  <Stroke size={size} stroke={stroke} width={2.6} d="M5 12.5 L10 17.5 L19 7" />
);
export const PaperclipIcon = () => (
  <Stroke
    size={18}
    stroke="var(--ink)"
    width={1.8}
    d="M20 11.5 L12.5 19 a4.5 4.5 0 0 1 -6.4 -6.4 L13.6 5.1 a3 3 0 0 1 4.3 4.3 L10.4 16.9 a1.5 1.5 0 0 1 -2.1 -2.1 L15 8"
  />
);
export const PlusIcon = () => (
  <Stroke size={18} stroke="var(--on-ink)" width={2} d="M12 5 V19 M5 12 H19" />
);
export const SendIcon = () => (
  <Stroke size={18} stroke="var(--on-ink)" width={2} d="M12 19 V5 M6 11 L12 5 L18 11" />
);
export const MicIcon = ({ stroke }: { stroke: string }) => (
  <Stroke
    size={18}
    stroke={stroke}
    width={1.8}
    d="M12 4 a3 3 0 0 0 -3 3 V12 a3 3 0 0 0 6 0 V7 a3 3 0 0 0 -3 -3 Z M6 11.5 a6 6 0 0 0 12 0 M12 17.5 V21"
  />
);

export function SproutIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      style={{ stroke: 'var(--accent)' }}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        className="draw"
        pathLength={100}
        d="M12 21 V11 M12 14 C12 10 9 8 5 8 C5 12 8 14 12 14 Z M12 11 C12 7 15 4 19 4 C19 8 16 11 12 11 Z"
      />
    </svg>
  );
}
