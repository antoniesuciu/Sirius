/**
 * The phone layout (F38): one area at a time behind a bottom bar, instead of every desktop
 * panel stacked in one long scroll. The desktop layout does not use any of this.
 */
import type { EntityName } from '@sirius/contracts';
import { MicIcon } from './Icons.tsx';

export type PhoneTab = 'sirius' | 'today' | 'plan' | 'list';

export const PHONE_TABS: ReadonlyArray<{ id: PhoneTab; label: string }> = [
  { id: 'sirius', label: 'Sirius' },
  { id: 'today', label: 'Today' },
  { id: 'plan', label: 'Plan' },
  { id: 'list', label: 'List' },
];

/** Where a change to this kind of row shows up, so its tab can say something is new. */
export function tabForEntity(entity: EntityName): PhoneTab | null {
  switch (entity) {
    case 'tasks':
    case 'schedule_events':
      return 'today';
    case 'goals':
    case 'milestones':
    case 'roadmaps':
    case 'roadmap_steps':
      return 'plan';
    case 'list_items':
    case 'reminders':
      return 'list';
    case 'messages':
    case 'proposals':
      return 'sirius';
    default:
      return null;
  }
}

/** A line under a reply that names what Sirius changed and opens it. */
export interface Receipt {
  label: string;
  tab: PhoneTab;
}

function receiptForOp(op: string): Receipt | null {
  // Reads change nothing, so they get no receipt.
  if (op.startsWith('get_') || op.startsWith('list_')) return null;
  if (op === 'step_to_today' || op.includes('task')) return { label: 'Today', tab: 'today' };
  if (op.includes('schedule')) return { label: 'Schedule', tab: 'today' };
  if (op.includes('roadmap')) return { label: 'Learning', tab: 'plan' };
  if (op.includes('goal') || op.includes('milestone')) return { label: 'Goals', tab: 'plan' };
  if (op.includes('list')) return { label: 'List', tab: 'list' };
  if (op.includes('reminder')) return { label: 'Reminders', tab: 'list' };
  return null;
}

/** One receipt per area, in the order the agent first touched it. */
export function receiptsFor(tools: readonly string[]): Receipt[] {
  const seen = new Map<string, Receipt>();
  for (const tool of tools) {
    const receipt = receiptForOp(tool);
    if (receipt && !seen.has(receipt.label)) seen.set(receipt.label, receipt);
  }
  return [...seen.values()];
}

/** The same for a spoken command that the core did at once (voice fast path). */
export function receiptForIntent(intent: string | null | undefined): Receipt | null {
  if (intent === 'add_task') return { label: 'Today', tab: 'today' };
  if (intent === 'add_to_list') return { label: 'List', tab: 'list' };
  if (intent === 'remind') return { label: 'Reminders', tab: 'list' };
  return null;
}

export interface TabBarProps {
  active: PhoneTab;
  /** Tabs with something new since they were last open. */
  fresh: ReadonlySet<PhoneTab>;
  onSelect(tab: PhoneTab): void;
  micOpen: boolean;
  /** Sending a recording or saying the reply: the mic then stops that instead. */
  micBusy: boolean;
  onMic(): void;
}

export function TabBar({ active, fresh, onSelect, micOpen, micBusy, onMic }: TabBarProps) {
  const tab = (t: (typeof PHONE_TABS)[number]) => (
    <button
      key={t.id}
      type="button"
      className="tab"
      aria-current={t.id === active ? 'page' : undefined}
      onClick={() => onSelect(t.id)}
    >
      {t.label}
      {fresh.has(t.id) && t.id !== active && (
        <span className="tab-dot" role="img" aria-label="something new" />
      )}
    </button>
  );
  return (
    <nav className="tab-bar" aria-label="Sections">
      <div className="tab-group">{PHONE_TABS.slice(0, 2).map(tab)}</div>
      <button
        type="button"
        className={`tab-mic ${micOpen ? 'tab-mic-live' : ''}`}
        aria-label={micOpen ? 'Stop listening' : micBusy ? 'Stop' : 'Talk to Sirius'}
        aria-pressed={micOpen}
        onClick={onMic}
      >
        <MicIcon stroke={micOpen ? '#F4EEE1' : '#1A1814'} />
      </button>
      <div className="tab-group">{PHONE_TABS.slice(2).map(tab)}</div>
    </nav>
  );
}
