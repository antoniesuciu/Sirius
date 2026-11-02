export interface WindowControlsProps {
  onMinimize(): void;
  onToggleMaximize(): void;
  /** Closing hides to the tray, because reminders keep running. */
  onClose(): void;
}

/**
 * The window has no system title bar, so this replaces it: a thin strip to drag by, and the three
 * buttons. `data-tauri-drag-region` is all Tauri needs, and it also gives double-click to maximise.
 */
export function WindowControls({ onMinimize, onToggleMaximize, onClose }: WindowControlsProps) {
  return (
    <>
      <div className="window-drag" data-tauri-drag-region />
      <div className="window-controls">
        <button type="button" aria-label="Minimise" onClick={onMinimize}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 6h8" />
          </svg>
        </button>
        <button type="button" aria-label="Maximise" onClick={onToggleMaximize}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
          </svg>
        </button>
        <button type="button" aria-label="Close" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
          </svg>
        </button>
      </div>
    </>
  );
}
