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
      {/* pathLength 100: a stroke can draw itself in with the `draw` keyframes. */}
      <path d={d} pathLength={100} />
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
/** "One step closer", on a goal: the send arrow, in ink on the panel. */
export const StepIcon = () => (
  <Stroke size={18} stroke="var(--ink)" width={2} d="M12 19 V5 M6 11 L12 5 L18 11" />
);
export const StopIcon = () => (
  <Stroke size={18} stroke="var(--on-ink)" width={2} d="M8 8 H16 V16 H8 Z" />
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
/** Remove or let go of something; in the colour of its button's text. */
export const CloseIcon = ({ size = 16 }: { size?: number }) => (
  <Stroke size={size} stroke="currentColor" width={2} d="M6 6 L18 18 M18 6 L6 18" />
);
/** Goes to where a change was made (a receipt on the phone). */
export const ArrowRightIcon = () => (
  <Stroke size={14} stroke="currentColor" width={2} d="M5 12 H19 M13 6 L19 12 L13 18" />
);
/** Opens a full page, such as a roadmap. */
export const OpenIcon = () => (
  <Stroke size={14} stroke="currentColor" width={2} d="M7 17 L17 7 M9 7 H17 V15" />
);
export const ChevronIcon = () => (
  <Stroke size={16} stroke="var(--muted)" width={2} d="M6 9 L12 15 L18 9" />
);
/** Back to the list or the dashboard (F42's notes view). */
export const BackIcon = () => (
  <Stroke size={18} stroke="var(--ink)" width={2} d="M19 12 H5 M11 6 L5 12 L11 18" />
);
/** A pushpin: pinned notes list first (F42). */
export const PinIcon = () => (
  <Stroke
    size={18}
    stroke="var(--ink)"
    width={1.8}
    d="M9 4 H15 M10 4 V10 L7 14 H17 L14 10 V4 M12 14 V20"
  />
);
