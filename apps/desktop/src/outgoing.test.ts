import { expect, test } from 'bun:test';
import {
  type Attachment,
  IDLE,
  type Outgoing,
  outgoingReducer,
  pendingLine,
  uploaded,
  withoutSent,
} from './outgoing.ts';

const send = (text: string, at: number, after: string | null = 'm1', fileIds: string[] = []) =>
  ({ kind: 'send', text, fileIds, at, after }) as const;

test('a send is held until accepted, then shown until its stored copy arrives', () => {
  let o = outgoingReducer(IDLE, send('hei', 1));
  expect(o.kind).toBe('sending');
  expect(pendingLine(o, 'm1')).toEqual({ id: 'pending', mine: true, text: 'hei' });
  o = outgoingReducer(o, { kind: 'accepted', at: 1 });
  expect(o.kind).toBe('sent');
  expect(pendingLine(o, 'm1')).not.toBeNull();
  // A newer line of mine is stored: that is this message.
  expect(pendingLine(o, 'm2')).toBeNull();
});

test('resending the same words still shows the new message', () => {
  // The old rule hid the pending copy when any stored line of mine had the same text.
  let o = outgoingReducer(IDLE, send('hei', 1, 'm1'));
  o = outgoingReducer(o, { kind: 'accepted', at: 1 });
  o = outgoingReducer(o, send('hei', 2, 'm2'));
  expect(pendingLine(o, 'm2')).toEqual({ id: 'pending', mine: true, text: 'hei' });
});

test('the stored copy can land before the response, as on a fast core', () => {
  const o = outgoingReducer(IDLE, send('fail fast', 1, 'm1'));
  expect(pendingLine(o, 'm2')).toBeNull();
  expect(o.kind).toBe('sending');
});

test('a refused send keeps its text and error', () => {
  const o = outgoingReducer(outgoingReducer(IDLE, send('hei', 1)), {
    kind: 'refused',
    at: 1,
    error: 'Sirius is still answering.',
  });
  expect(o).toEqual({
    kind: 'failed',
    text: 'hei',
    error: 'Sirius is still answering.',
    at: 1,
    after: 'm1',
  });
  expect(pendingLine(o, 'm1')?.text).toBe('hei');
  // Sending again from a failure is allowed.
  expect(outgoingReducer(o, send('again', 2)).kind).toBe('sending');
});

test('a second send while one is out is ignored', () => {
  const o = outgoingReducer(IDLE, send('one', 1));
  expect(outgoingReducer(o, send('two', 2))).toBe(o);
});

test('a late answer to an older send changes nothing', () => {
  const sending = outgoingReducer(outgoingReducer(IDLE, send('one', 1)), send('two', 2));
  expect(outgoingReducer(sending, { kind: 'accepted', at: 0 })).toBe(sending);
  const sent = outgoingReducer(outgoingReducer(IDLE, send('one', 1)), { kind: 'accepted', at: 1 });
  expect(outgoingReducer(sent, { kind: 'refused', at: 1, error: 'x' })).toBe(sent);
});

test('reset forgets the message', () => {
  const o: Outgoing = outgoingReducer(IDLE, send('hei', 1));
  expect(outgoingReducer(o, { kind: 'reset' })).toEqual(IDLE);
  expect(pendingLine(IDLE, null)).toBeNull();
});

const file = (id: string, fileId: string | null): Attachment => ({
  id,
  name: `${id}.md`,
  detail: fileId ? '' : 'uploading',
  state: fileId ? 'ready' : 'uploading',
  fileId,
});

test('an upload that finishes marks its row ready', () => {
  const files = uploaded([file('u1', null), file('u2', null)], 'u1', {
    fileId: 'f1',
    name: 'notes.md',
    detail: '2 pages',
  });
  expect(files[0]).toEqual({
    id: 'u1',
    name: 'notes.md',
    detail: '2 pages',
    state: 'ready',
    fileId: 'f1',
  });
  expect(files[1]?.state).toBe('uploading');
});

test('a file removed while uploading stays removed', () => {
  expect(uploaded([file('u2', null)], 'u1', { fileId: 'f1', name: 'a', detail: '' })).toEqual([
    file('u2', null),
  ]);
});

test('only the files that went with a message are cleared', () => {
  const files = [file('u1', 'f1'), file('u2', 'f2'), file('u3', null)];
  expect(withoutSent(files, ['f1'])).toEqual([file('u2', 'f2'), file('u3', null)]);
});
