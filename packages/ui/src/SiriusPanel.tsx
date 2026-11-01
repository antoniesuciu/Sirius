import type { AgentId, AgentInfo, AgentStatusValue, Proposal } from '@sirius/contracts';
import type { FormEvent, KeyboardEvent } from 'react';
import { useState } from 'react';
import { useSmoothedText } from './hooks.ts';
import { MicIcon, SendIcon } from './Icons.tsx';
import { type AvatarState, SiriusAvatar } from './SiriusAvatar.tsx';

export interface ChatLine {
  id: string;
  mine: boolean;
  text: string;
}

export interface VoiceProps {
  /** The mic is open beyond wake-word detection (F33). */
  micOpen: boolean;
  transcript: string | null;
  onMic(): void;
}

export interface SiriusPanelProps {
  avatar: AvatarState;
  level: number;
  status: string;
  selected: AgentId;
  agents: AgentInfo[];
  onSelectAgent(agent: AgentId): void;
  onSelectModel(model: string): void;
  messages: ChatLine[];
  /** Streamed reply so far; null when no reply is arriving. */
  streaming: string | null;
  thinking: boolean;
  busy: boolean;
  proposals: Proposal[];
  onConfirm(proposal: Proposal): void;
  onReject(proposal: Proposal): void;
  undoLabel: string | null;
  onUndo(): void;
  chips: string[];
  onSend(text: string): void;
  onCancel(): void;
  onNewConversation(): void;
  voice: VoiceProps;
}

const STATUS_TEXT: Record<AgentStatusValue, string> = {
  idle: 'idle',
  working: 'working',
  waiting: 'waiting for you',
  resting: 'resting',
  unavailable: 'not set up',
};

function StreamingBubble({ text }: { text: string }) {
  const shown = useSmoothedText(text);
  return (
    <div className="bubble">
      {shown}
      <span className="caret" />
    </div>
  );
}

function ProposalCard({
  proposal,
  onConfirm,
  onReject,
}: {
  proposal: Proposal;
  onConfirm(p: Proposal): void;
  onReject(p: Proposal): void;
}) {
  return (
    <div className="proposal msg">
      <span className="proposal-text">{proposal.summary}</span>
      <div className="proposal-actions">
        <button type="button" className="pill pill-solid-panel" onClick={() => onConfirm(proposal)}>
          Confirm
        </button>
        <button type="button" className="pill" onClick={() => onReject(proposal)}>
          Not now
        </button>
      </div>
    </div>
  );
}

export function SiriusPanel(props: SiriusPanelProps) {
  const { voice } = props;
  const [draft, setDraft] = useState('');
  const active = props.agents.find((a) => a.id === props.selected);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = draft.trim();
    if (!clean || props.busy) return;
    props.onSend(clean);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && props.busy) props.onCancel();
  };

  return (
    <section className="panel panel-sirius rise d3" onKeyDown={onKey}>
      <div className="sirius-head">
        <div className="sirius-identity">
          <SiriusAvatar state={props.avatar} level={props.level} />
          <div className="sirius-name">
            <span className="sirius-title">Sirius</span>
            <span className="sirius-status">{props.status}</span>
          </div>
        </div>
        <fieldset className="agent-switch" aria-label="Agent">
          {props.agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              aria-pressed={agent.id === props.selected}
              onClick={() => props.onSelectAgent(agent.id)}
            >
              {agent.label}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="sirius-meta">
        <label className="model-select">
          <span>via</span>
          <select
            aria-label="Model"
            value={active?.model ?? ''}
            onChange={(e) => props.onSelectModel(e.target.value)}
          >
            {active?.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <span className="agent-states">
          {props.agents.map((agent) => (
            <span className="agent-state" key={agent.id}>
              <span
                className={`agent-dot ${agent.status === 'working' || agent.status === 'waiting' ? 'agent-dot-on' : ''}`}
              />
              {agent.label} · {STATUS_TEXT[agent.status]}
            </span>
          ))}
        </span>
      </div>

      <div className="chat-log" aria-live="polite">
        {/* column-reverse: newest first in the DOM, so the log pins to the bottom. */}
        {props.undoLabel && (
          <div className="undo-offer msg">
            <span>{props.undoLabel}</span>
            <button type="button" className="text-button" onClick={props.onUndo}>
              Undo
            </button>
          </div>
        )}
        {props.proposals.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            onConfirm={props.onConfirm}
            onReject={props.onReject}
          />
        ))}
        {props.thinking && (
          <div className="bubble bubble-thinking msg" role="status" aria-label="Sirius is thinking">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        )}
        {props.streaming !== null && <StreamingBubble text={props.streaming} />}
        {[...props.messages].reverse().map((m) => (
          <div key={m.id} className={m.mine ? 'bubble bubble-me msg' : 'bubble'}>
            {m.text}
          </div>
        ))}
      </div>

      {voice.transcript && <div className="transcript">{voice.transcript}</div>}

      <div className="chips">
        {props.chips.map((chip) => (
          <button
            key={chip}
            type="button"
            className="chip"
            disabled={props.busy}
            onClick={() => props.onSend(chip)}
          >
            {chip}
          </button>
        ))}
      </div>

      <form className="chat-form" onSubmit={submit}>
        <input
          type="text"
          aria-label="Message Sirius"
          placeholder="Ask Sirius for something small"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          className="round round-lg mic"
          aria-label={voice.micOpen ? 'Stop listening' : 'Talk to Sirius'}
          aria-pressed={voice.micOpen}
          onClick={voice.onMic}
        >
          <MicIcon stroke={voice.micOpen ? '#F4EEE1' : '#1A1814'} />
        </button>
        <button type="submit" className="round round-lg" aria-label="Send" disabled={props.busy}>
          <SendIcon />
        </button>
      </form>

      <div className="chat-foot">
        {voice.micOpen ? (
          <span className="mic-indicator" role="status">
            <span className="mic-indicator-dot mic-live" />
            Microphone on
          </span>
        ) : (
          <span />
        )}
        {props.busy ? (
          <button type="button" className="text-button" onClick={props.onCancel}>
            Stop
          </button>
        ) : (
          <button type="button" className="text-button" onClick={props.onNewConversation}>
            New conversation
          </button>
        )}
      </div>
    </section>
  );
}
