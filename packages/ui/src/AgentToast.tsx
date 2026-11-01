export interface AgentToastProps {
  text: string;
  onGotIt(): void;
  onLater(): void;
}

export function AgentToast({ text, onGotIt, onLater }: AgentToastProps) {
  return (
    <div className="toast" role="status">
      <span>{text}</span>
      <div className="toast-actions">
        <button type="button" className="pill" onClick={onGotIt}>
          Got it
        </button>
        <button type="button" className="pill pill-ghost" onClick={onLater}>
          Later
        </button>
      </div>
    </div>
  );
}
