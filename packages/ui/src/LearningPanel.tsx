import type { RoadmapStep, RoadmapView } from '@sirius/contracts';
import type { CSSProperties } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { InlineEdit } from './InlineEdit.tsx';

export interface LearningPanelProps {
  roadmaps: RoadmapView[];
  onStepToToday(stepId: string): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
}

/** How far past the current node the vine reaches, so it reads as progress towards the next. */
const VINE_REACH_PX = 44;

export function nextStep(roadmap: RoadmapView): RoadmapStep | undefined {
  return roadmap.steps.find((s) => s.status === 'todo');
}

function nextLine(roadmap: RoadmapView, step: RoadmapStep | undefined): string {
  if (step) {
    const estimate = step.est_minutes ? ` About ${step.est_minutes} minutes, no more.` : '';
    return `Next: ${step.title}.${estimate}`;
  }
  if (roadmap.status === 'done' || roadmap.steps.length > 0) return 'All done here.';
  if (roadmap.status === 'later')
    return 'Nothing to do yet. It will be here when the rest is ready.';
  return 'No first step yet. Ask Sirius to sketch one.';
}

/** Measures where the vine should stop. Scaling a full-height rail keeps this transform-only. */
function useVine(currentId: string | undefined, selected: string | null, count: number) {
  const path = useRef<HTMLDivElement>(null);
  const [vine, setVine] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    const root = path.current;
    if (!root) return;
    const railHeight = Math.max(root.offsetHeight - 44, 1);
    const node = currentId ? root.querySelector<HTMLElement>(`[data-node="${currentId}"]`) : null;
    const px = Math.min((node?.offsetTop ?? 0) + VINE_REACH_PX, railHeight);
    setVine({ '--vine-scale': px / railHeight, '--vine-px': `${px}px` } as CSSProperties);
  }, [currentId, selected, count]);

  return { path, vine };
}

export function LearningPanel({ roadmaps, onStepToToday, onRename, onDelete }: LearningPanelProps) {
  const current = roadmaps.find((r) => r.status === 'active');
  const [selected, setSelected] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  // Until the user picks something, the current roadmap stays expanded (F12).
  const open = touched ? selected : (current?.id ?? null);
  const { path, vine } = useVine(current?.id, open, roadmaps.length);

  return (
    <section className="panel rise d2">
      <div className="panel-head">
        <h2>Learning</h2>
      </div>
      <div className="path" ref={path}>
        <div className="rail" aria-hidden="true" style={vine}>
          <div className="vfill" />
          <div className="vtip-anchor">
            <div className="vtip" />
          </div>
        </div>
        {roadmaps.map((roadmap, i) => {
          const isCurrent = roadmap.id === current?.id;
          const isOpen = open === roadmap.id;
          const step = nextStep(roadmap);
          return (
            <div
              className="node pop"
              key={roadmap.id}
              data-node={roadmap.id}
              style={{ animationDelay: `${0.7 + i * 0.35}s` }}
            >
              <button
                type="button"
                className="node-button"
                aria-expanded={isOpen}
                onClick={() => {
                  setTouched(true);
                  setSelected(isOpen ? null : roadmap.id);
                }}
              >
                <span className="node-mark">
                  {isCurrent ? (
                    <span className="node-current">
                      <span className="ringwave" />
                      <span className="node-current-dot" />
                    </span>
                  ) : (
                    <span
                      className={`node-later ${roadmap.status === 'done' ? 'node-done' : ''}`}
                    />
                  )}
                </span>
                <span className="node-text">
                  <span className="node-title">{roadmap.title}</span>
                  <span className="node-meta">{roadmap.subtitle ?? ''}</span>
                </span>
              </button>
              {isOpen && (
                <div className="node-next msg">
                  <span>{nextLine(roadmap, step)}</span>
                  {step && (
                    <button type="button" className="pill" onClick={() => onStepToToday(step.id)}>
                      Put it in Today
                    </button>
                  )}
                  <InlineEdit
                    title={roadmap.title}
                    noun="roadmap"
                    onRename={(title) => onRename(roadmap.id, title)}
                    onDelete={() => onDelete(roadmap.id)}
                  >
                    {null}
                  </InlineEdit>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
