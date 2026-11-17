import type { RoadmapStep } from '@sirius/contracts';
import { CheckIcon } from './Icons.tsx';

/** SVG route geometry and its keyboard-accessible checkpoint controls. */
export function RoadmapRoute({
  steps,
  currentId,
  selectedId,
  onSelect,
}: {
  steps: RoadmapStep[];
  currentId?: string;
  selectedId?: string;
  onSelect(id: string): void;
}) {
  const routeHeight = Math.max(steps.length * 175 + 100, 350);
  const routePath = steps
    .map((_, i) => {
      const x = i % 2 ? 560 : 200;
      const y = 90 + i * 175;
      return i === 0
        ? `M ${x} ${y}`
        : `C ${i % 2 ? 200 : 560} ${y - 85}, ${x} ${y - 85}, ${x} ${y}`;
    })
    .join(' ');
  return (
    <div className="route-map" style={{ height: routeHeight }} aria-label="Milestone route">
      <svg
        className="route-line"
        viewBox={`0 0 760 ${routeHeight}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d={routePath} />
      </svg>
      {steps.map((step, i) => (
        <button
          type="button"
          key={step.id}
          className={`map-checkpoint ${step.status === 'done' ? 'is-done' : ''} ${step.id === currentId ? 'is-current' : ''} ${step.id === selectedId ? 'is-selected' : ''}`}
          style={{ left: `${((i % 2 ? 560 : 200) / 760) * 100}%`, top: 90 + i * 175 }}
          aria-pressed={step.id === selectedId}
          aria-current={step.id === currentId ? 'step' : undefined}
          aria-label={`Milestone ${i + 1}: ${step.title}${step.status === 'done' ? ', complete' : ''}`}
          onClick={() => onSelect(step.id)}
        >
          {/* The number is drawn by CSS so it stays out of the accessible name (axe label-content-name-mismatch). */}
          <span
            className="checkpoint-dot"
            data-n={step.status === 'done' ? undefined : String(i + 1).padStart(2, '0')}
          >
            {step.status === 'done' && <CheckIcon size={22} stroke="currentColor" />}
          </span>
          <span className="checkpoint-label">{step.title}</span>
        </button>
      ))}
      {steps.length === 0 && (
        <p className="empty-line route-empty">Your route starts with a milestone.</p>
      )}
    </div>
  );
}
