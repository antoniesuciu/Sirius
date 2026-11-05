import type { RoadmapStep, RoadmapView } from '@sirius/contracts';
import { useEffect, useState } from 'react';
import { InlineEdit } from './InlineEdit.tsx';
import type { RoadmapActions } from './RoadmapDetail.tsx';
import { RoadmapDetail } from './RoadmapDetail.tsx';

export interface LearningPanelProps extends RoadmapActions {
  roadmaps: RoadmapView[];
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
}

export function nextStep(roadmap: RoadmapView): RoadmapStep | undefined {
  return roadmap.steps.find((s) => s.status === 'todo');
}

/** Every roadmap has its own route; no line connects unrelated subjects. */
export function LearningPanel({ roadmaps, onRename, onDelete, ...actions }: LearningPanelProps) {
  const [selected, setSelected] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('roadmap'),
  );
  useEffect(() => {
    const pop = () => setSelected(new URLSearchParams(location.search).get('roadmap'));
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const openRoadmap = (id: string) => {
    const url = new URL(location.href);
    url.searchParams.set('roadmap', id);
    history.pushState({ siriusRoadmap: true }, '', url);
    setSelected(id);
  };
  const closeRoadmap = () => {
    if (history.state?.siriusRoadmap) history.back();
    else {
      const url = new URL(location.href);
      url.searchParams.delete('roadmap');
      history.replaceState(null, '', url);
      setSelected(null);
    }
  };
  const chosen = roadmaps.find((r) => r.id === selected);
  return (
    <section className="panel rise d2 panel-learning">
      <div className="panel-head">
        <h2>Learning</h2>
        <span className="label">Roadmaps</span>
      </div>
      <div className="roadmap-cards">
        {roadmaps.map((roadmap) => {
          const step = nextStep(roadmap);
          const done = roadmap.steps.filter((s) => s.status === 'done').length;
          return (
            <article className="roadmap-card node" key={roadmap.id}>
              <InlineEdit
                title={roadmap.title}
                noun="roadmap"
                onRename={(title) => onRename(roadmap.id, title)}
                onDelete={() => onDelete(roadmap.id)}
              >
                <button
                  type="button"
                  className="roadmap-open node-button"
                  aria-haspopup="dialog"
                  onClick={() => openRoadmap(roadmap.id)}
                >
                  <span className="node-title">{roadmap.title}</span>
                  <span className="roadmap-count">
                    {done} / {roadmap.steps.length} milestones <span aria-hidden="true">↗</span>
                  </span>
                </button>
              </InlineEdit>
              <div className="roadmap-summary">
                <p className="roadmap-next">
                  {step
                    ? `Next: ${step.title}.`
                    : roadmap.steps.length
                      ? 'All milestones complete.'
                      : 'No milestones yet. Open to plan your route.'}
                </p>
                {step && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => actions.onStepToToday(step.id)}
                  >
                    Put it in Today
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {roadmaps.length === 0 && (
          <p className="roadmap-subtitle">Ask Sirius to create a learning roadmap.</p>
        )}
      </div>
      {chosen && (
        <RoadmapDetail key={chosen.id} roadmap={chosen} onClose={closeRoadmap} {...actions} />
      )}
    </section>
  );
}
