import { describe, expect, test } from 'bun:test';
import { receiptForIntent, receiptsFor, tabForEntity } from '@sirius/ui';
import { forSpeech, speechTag, takeSentences } from './speech.ts';

describe('saying replies on the phone (F38)', () => {
  test('streamed text is said a whole sentence at a time', () => {
    expect(takeSentences('Done. Gym is on Tuesdays and Th')).toEqual({
      sentences: ['Done.'],
      rest: 'Gym is on Tuesdays and Th',
    });
    // A full stop inside a number or with no space after it is not the end of a sentence.
    expect(takeSentences('It costs 3.5 euros! Ok')).toEqual({
      sentences: ['It costs 3.5 euros!'],
      rest: 'Ok',
    });
  });

  test('Markdown is not read out', () => {
    expect(forSpeech('**Gym** at `18:00`, see [the plan](http://x).')).toBe(
      'Gym at 18:00, see the plan.',
    );
  });

  test('Romanian gets a Romanian voice, anything else English', () => {
    expect(speechTag('ro')).toBe('ro-RO');
    expect(speechTag('en')).toBe('en-US');
    expect(speechTag('de')).toBe('en-US');
  });
});

describe('what a reply changed', () => {
  test('one link per area, reads ignored', () => {
    expect(
      receiptsFor(['list_goals', 'add_goal', 'add_milestone', 'add_schedule_event', 'remember']),
    ).toEqual([
      { label: 'Goals', tab: 'plan' },
      { label: 'Schedule', tab: 'today' },
    ]);
    expect(receiptsFor(['step_to_today', 'add_roadmap_step'])).toEqual([
      { label: 'Today', tab: 'today' },
      { label: 'Learning', tab: 'plan' },
    ]);
    expect(receiptsFor(['add_to_list', 'set_reminder'])).toEqual([
      { label: 'List', tab: 'list' },
      { label: 'Reminders', tab: 'list' },
    ]);
  });

  test('spoken commands and changed rows map to their tab', () => {
    expect(receiptForIntent('add_task')).toEqual({ label: 'Today', tab: 'today' });
    expect(receiptForIntent('what_time')).toBeNull();
    expect(tabForEntity('schedule_events')).toBe('today');
    expect(tabForEntity('roadmap_steps')).toBe('plan');
    expect(tabForEntity('voice_turns')).toBeNull();
  });
});
