import type { AgentId, AgentInfo, AgentStatusValue, OrbStyle, Proposal } from '@sirius/contracts';
import type { FormEvent, KeyboardEvent } from 'react';
import { useRef, useState } from 'react';
import { useSmoothedText } from './hooks.ts';
import { MicIcon, PaperclipIcon, SendIcon } from './Icons.tsx';
import { ModelPicker } from './ModelPicker.tsx';
import type { PhoneTab, Receipt } from './PhoneTabs.tsx';
// The wolf is kept in SiriusAvatar.tsx but not shown for now (owner, 2026-11-03). Its states
// still show as the status line.
import type { AvatarState } from './SiriusAvatar.tsx';
import { VoiceOrb } from './VoiceOrb.tsx';

export interface ChatLine {
  id: string;
  mine: boolean;
  text: string;
  /** Names of files sent with the message (F36). */
  attachments?: string[];
  /** What this reply changed, shown as links on the phone (F38). */
  receipts?: Receipt[];
}

/** A file waiting to go with the next message. */
export interface PendingFile {
  id: string;
  name: string;
  /** Such as "12 pages" or "cut to fit". */
  detail: string;
}

export interface VoiceProps {
  /** The mic is open beyond wake-word detection (F33). */
  micOpen: boolean;
  transcript: string | null;
  onMic(): void;
  /** Esc: abort listening or speaking (F28). */
  onStop(): void;
}

export interface SiriusPanelProps {
  avatar: AvatarState;
  level: number;
  still: boolean;
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
  onSend(text: string): void;
  files: PendingFile[];
  onAttach(file: File): void;
  onRemoveFile(id: string): void;
  onCancel(): void;
  onNewConversation(): void;
  voice: VoiceProps;
  /** On the phone: opens the tab a receipt points to. Without it, receipts are not shown. */
  onOpenTab?(tab: PhoneTab): void;
  /** On the phone: one short header, so the chat gets the height. */
  compact?: boolean;
  /** A live loudness 0–1, such as the phone's microphone, read every frame by the orb. */
  readLevel?(): number;
  /** The voice animation and the theme it takes its colours from (F40). */
  orb?: OrbStyle;
  theme?: string;
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

  const picker = useRef<HTMLInputElement>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = draft.trim();
    if ((!clean && props.files.length === 0) || props.busy) return;
    props.onSend(clean || 'See the attached document.');
    setDraft('');
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (voice.micOpen || props.avatar === 'speaking') voice.onStop();
    else if (props.busy) props.onCancel();
  };

  const orbProps = {
    state: props.avatar,
    level: props.level,
    ...(props.orb ? { orb: props.orb } : {}),
    ...(props.theme ? { theme: props.theme } : {}),
    ...(props.readLevel ? { readLevel: props.readLevel } : {}),
  };
  const headOrb = <VoiceOrb {...orbProps} size={44} />;
  // Large, over the chat, while a voice is on: the person talking or Sirius answering aloud.
  const stage = props.avatar === 'listening' || props.avatar === 'speaking';

  const agentSwitch = (
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
  );
  const modelSelect = (
    <div className="model-select">
      <span>via</span>
      <ModelPicker
        models={active?.models ?? []}
        value={active?.model ?? ''}
        onChange={props.onSelectModel}
      />
    </div>
  );

  return (
    <section className="panel panel-sirius rise d3" onKeyDown={onKey}>
      {props.compact ? (
        <div className="sirius-head sirius-head-compact">
          {headOrb}
          <div className="sirius-controls">
            <div className="sirius-controls-top">
              {agentSwitch}
              {/* Here rather than on a row of its own under the chat, which a phone cannot spare. */}
              {!props.busy && (
                <button
                  type="button"
                  className="text-button new-chat"
                  onClick={props.onNewConversation}
                >
                  New chat
                </button>
              )}
            </div>
            <div className="sirius-meta-line">
              {/* No "via" here: on a 360 px phone it is what pushed the status onto a new line. */}
              <ModelPicker
                models={active?.models ?? []}
                value={active?.model ?? ''}
                onChange={props.onSelectModel}
              />
              <span className="sirius-status">{props.status}</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="sirius-head">
            <div className="sirius-identity" data-state={props.avatar}>
              {headOrb}
              <div className="sirius-name">
                <span className="sirius-title">Sirius</span>
                <span className="sirius-status">{props.status}</span>
              </div>
            </div>
            {agentSwitch}
          </div>

          <div className="sirius-meta">
            {modelSelect}
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
        </>
      )}

      <div className="chat-area">
        {stage && (
          <div className="voice-stage" aria-hidden="true">
            <VoiceOrb {...orbProps} size={props.compact ? 200 : 180} />
          </div>
        )}
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
            <div
              className="bubble bubble-thinking msg"
              role="status"
              aria-label="Sirius is thinking"
            >
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          )}
          {props.streaming !== null && <StreamingBubble text={props.streaming} />}
          {[...props.messages].reverse().map((m) => {
            const open = props.onOpenTab;
            const bubble = (
              <div key={m.id} className={m.mine ? 'bubble bubble-me msg' : 'bubble'}>
                {m.text}
                {m.attachments && m.attachments.length > 0 && (
                  <span className="bubble-files">{m.attachments.join(' · ')}</span>
                )}
              </div>
            );
            if (!open || !m.receipts?.length) return bubble;
            return (
              <div key={m.id} className="reply-with-receipts">
                {bubble}
                <div className="receipts">
                  {m.receipts.map((r) => (
                    <button
                      key={r.label}
                      type="button"
                      className="receipt"
                      onClick={() => open(r.tab)}
                    >
                      Changed {r.label} <span aria-hidden="true">→</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {voice.transcript && <div className="transcript">{voice.transcript}</div>}

      {props.files.length > 0 && (
        <ul className="pending-files" aria-label="Files to send">
          {props.files.map((f) => (
            <li key={f.id} className="pending-file">
              <span>
                {f.name} <span className="pending-file-detail">{f.detail}</span>
              </span>
              <button
                type="button"
                className="text-button"
                aria-label={`Remove ${f.name}`}
                onClick={() => props.onRemoveFile(f.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="chat-form" onSubmit={submit}>
        <input
          ref={picker}
          type="file"
          hidden
          multiple
          accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
          onChange={(e) => {
            for (const file of e.target.files ?? []) props.onAttach(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="round round-lg attach"
          aria-label="Attach a PDF or Markdown file"
          disabled={props.busy || props.files.length >= 3}
          onClick={() => picker.current?.click()}
        >
          <PaperclipIcon />
        </button>
        <input
          type="text"
          aria-label="Message Sirius"
          placeholder="Ask Sirius"
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
          <MicIcon stroke={voice.micOpen ? 'var(--on-ink)' : 'var(--ink)'} />
        </button>
        <button type="submit" className="round round-lg" aria-label="Send" disabled={props.busy}>
          <SendIcon />
        </button>
      </form>

      {/* On the phone the row appears only while it has something to say. */}
      {(!props.compact || voice.micOpen || props.busy) && (
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
          ) : props.compact ? null : (
            <button type="button" className="text-button" onClick={props.onNewConversation}>
              New conversation
            </button>
          )}
        </div>
      )}
    </section>
  );
}
