/**
 * Routes a final transcript: known commands run through the same dispatcher as everything
 * else, and the rest goes to the selected agent as a voice turn (F30).
 */
import {
  addDays,
  localParts,
  type OpInput,
  type OpOutput,
  type Proposal,
  weekdayOf,
  zonedInstant,
} from '@sirius/contracts';
import type { EventBus } from '../bus.ts';
import type { Caller, Dispatcher } from '../dispatcher.ts';
import type { Chat, TurnObserver } from '../services/chat.ts';
import type { Store } from '../store.ts';
import { uuidv7 } from '../uuid.ts';
import { type Intent, parseIntent } from './intents.ts';
import { type Lang, replies, replyLang } from './replies.ts';

/** A proposal may be confirmed by voice only this soon after it appears (F32). */
export const VOICE_CONFIRM_WINDOW_MS = 15_000;
const SNOOZE_MS = 60 * 60 * 1000;
const USER: Caller = { actor: 'user', via: 'voice' };

/** Anything in here removes something, and F32 keeps deletes behind a tap. */
const needsTap = (proposal: Proposal) =>
  proposal.ops.some(({ op }) => op.startsWith('delete_') || op === 'drop_task');

export class VoiceRouter implements TurnObserver {
  private readonly turnLang = new Map<string, Lang>();

  constructor(
    private readonly store: Store,
    private readonly bus: EventBus,
    private readonly chat: () => Chat,
    private readonly run: () => Dispatcher,
    private readonly timeZone: string,
  ) {}

  utterance(input: OpInput<'voice_utterance'>): OpOutput<'voice_utterance'> {
    const lang = replyLang(input.lang);
    const intent = parseIntent(input.transcript);

    if (intent) {
      const reply = this.execute(intent, lang);
      this.record(input, 'fast_path', intent.kind);
      return { route: 'fast_path', turn_id: uuidv7(), intent: intent.kind, reply };
    }

    if (this.chat().activeAgent()) {
      // Said aloud, this needs an answer: a silent 409 would look like Sirius ignored you.
      const reply = replies(lang).stillAnswering;
      this.record(input, 'fast_path', 'busy');
      return { route: 'fast_path', turn_id: uuidv7(), intent: 'busy', reply };
    }

    const { turn_id } = this.chat().send({ text: input.transcript, via: 'voice' });
    this.turnLang.set(turn_id, lang);
    this.record(input, 'agent', null);
    return { route: 'agent', turn_id, intent: null, reply: null };
  }

  private record(
    input: OpInput<'voice_utterance'>,
    route: 'fast_path' | 'agent',
    intent: string | null,
  ): void {
    this.store.write('user', (tx) =>
      tx.insert('voice_turns', {
        lang: input.lang,
        transcript: input.transcript,
        route,
        intent,
        latency_ms: input.latency_ms ?? null,
      }),
    );
  }

  private execute(intent: Intent, lang: Lang): string | null {
    const say = replies(lang);
    const run = this.run();
    switch (intent.kind) {
      case 'add_task': {
        run.run('add_task', { title: intent.title }, USER);
        return say.added(intent.title);
      }
      case 'add_to_list': {
        run.run('add_to_list', { text: intent.text }, USER);
        return say.listed(intent.text);
      }
      case 'remind':
        this.remind(intent.time, intent.label);
        return say.reminded(intent.time);
      case 'whats_next':
        return this.whatsNext(lang);
      case 'what_time': {
        const { hour, minute } = localParts(this.store.now(), this.timeZone);
        const pad = (n: number) => String(n).padStart(2, '0');
        return say.time(`${pad(hour)}:${pad(minute)}`);
      }
      case 'start_breathing':
        this.bus.publish({ type: 'ui_action', action: 'start_breathing' });
        return say.breathing;
      case 'done_for_today':
        run.run('set_quiet_mode', { on: true }, USER);
        return say.quiet;
      case 'snooze':
        return this.snooze(lang);
      case 'confirm':
        return this.decide(lang, true);
      case 'cancel':
        return this.decide(lang, false);
    }
  }

  /** One-off: today if the time is still ahead, otherwise tomorrow. */
  private remind(time: string, label: string): void {
    const now = this.store.now();
    const { year, month, day } = localParts(now, this.timeZone);
    const today = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const date = zonedInstant(today, time, this.timeZone) > now ? today : addDays(today, 1);
    this.run().run(
      'set_reminder',
      { label, kind: 'custom', time_local: time, weekdays: 1 << weekdayOf(date), once: true },
      USER,
    );
  }

  private whatsNext(lang: Lang): string {
    const say = replies(lang);
    const today = this.run().run('get_today', {}, USER);
    const open = today.tasks.filter((t) => t.status === 'open');
    const next = open.find((t) => t.tier === 'priority') ?? open[0];
    if (next) return say.next(next.title);
    if (today.next_reminder) {
      return say.nextReminder(today.next_reminder.label, today.next_reminder.time_local);
    }
    return say.nothingNext;
  }

  private snooze(lang: Lang): string {
    const say = replies(lang);
    const now = this.store.now();
    const { year, month, day } = localParts(now, this.timeZone);
    const calendar = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const reminder = this.run()
      .run('list_reminders', {}, USER)
      .filter((r) => r.last_fired_on === calendar)
      .sort((a, b) => b.updated_at - a.updated_at)[0];
    if (!reminder) return say.nothingToSnooze;
    this.run().run('snooze_reminder', { id: reminder.id, until: now + SNOOZE_MS }, USER);
    return say.snoozed(reminder.label);
  }

  /** F28: "cancel" with nothing to decline just ends the session, so it stays silent. */
  private decide(lang: Lang, confirm: boolean): string | null {
    const say = replies(lang);
    const pending = this.run()
      .run('list_proposals', {}, USER)
      .sort((a, b) => b.created_at - a.created_at)[0];
    if (!pending) return confirm ? say.nothingToConfirm : null;
    if (!confirm) {
      this.run().run('reject_proposal', { id: pending.id }, USER);
      return say.rejected;
    }
    if (needsTap(pending)) return say.needsTap;
    if (this.store.now() - pending.created_at > VOICE_CONFIRM_WINDOW_MS) return say.tooLate;
    this.run().run('confirm_proposal', { id: pending.id }, USER);
    return say.confirmed;
  }

  /** Agent replies are passed on as they stream; the voice service splits them into sentences. */
  text(turnId: string, delta: string): void {
    const lang = this.turnLang.get(turnId);
    if (!lang) return;
    this.bus.publish({ type: 'voice_reply', turn_id: turnId, text: delta, lang, final: false });
  }

  end(turnId: string): void {
    const lang = this.turnLang.get(turnId);
    if (!lang) return;
    this.turnLang.delete(turnId);
    this.bus.publish({ type: 'voice_reply', turn_id: turnId, text: '', lang, final: true });
  }
}
