import { describe, expect, test } from 'vitest';
import { Attachments, MAX_CHARS } from '../src/attachments.ts';
import { createApp } from '../src/http/app.ts';
import { CLAUDE, fakeAgent, harness, NOON_ISH } from './harness.ts';
import { tinyPdf } from './pdf.ts';

const enc = (s: string) => new TextEncoder().encode(s);

describe('reading what is attached (F36)', () => {
  test('Markdown is kept as it is', async () => {
    const kept = await new Attachments().put('plan.md', enc('# Analysis\n\n- Week 1: sequences'));
    expect(kept).toMatchObject({ name: 'plan.md', chars: 31, truncated: false, pages: null });
  });

  test('a PDF is read with pdftotext, with its page count', async () => {
    const files = new Attachments();
    const kept = await files.put(
      'syllabus.pdf',
      tinyPdf(['Week 1: Sequences', 'Week 2: Series'], 2),
    );
    expect(kept.pages).toBe(2);
    expect(files.take(kept.id)?.text).toContain('Week 2: Series');
  });

  test('a PDF without a text layer says so instead of sending nothing', async () => {
    const error = await new Attachments().put('scan.pdf', tinyPdf([])).catch((e) => e);
    expect(error.code).toBe('no_text');
  });

  test('other kinds of file are refused', async () => {
    const error = await new Attachments()
      .put('photo.png', new Uint8Array([137, 80]))
      .catch((e) => e);
    expect(error.code).toBe('unsupported_file');
  });

  test('a very long document is cut, and says it was', async () => {
    const files = new Attachments();
    const kept = await files.put('book.md', enc('x'.repeat(MAX_CHARS + 500)));
    expect(kept.truncated).toBe(true);
    expect(files.take(kept.id)?.text.length).toBe(MAX_CHARS);
  });

  test('a file is kept for an hour, then forgotten', async () => {
    let now = 0;
    const files = new Attachments(() => now);
    const kept = await files.put('a.md', enc('text'));
    now = 59 * 60 * 1000;
    expect(files.take(kept.id)).toBeDefined();
    now = 61 * 60 * 1000;
    expect(files.take(kept.id)).toBeUndefined();
  });
});

describe('attaching over HTTP', () => {
  const setup = () => {
    const h = harness();
    const app = createApp(h.core, { token: 't', mode: 'local', version: 'x' });
    const upload = (name: string, body: BodyInit, token = 't') =>
      app.request('/v1/attachments', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'x-filename': encodeURIComponent(name) },
        body,
      });
    return { h, app, upload };
  };

  test('needs a login like everything else', async () => {
    const { upload } = setup();
    expect((await upload('a.md', 'hi', 'wrong')).status).toBe(401);
  });

  test('keeps names with spaces and diacritics', async () => {
    const { upload } = setup();
    const reply = await upload('Analiză reală.md', '# Plan');
    expect(((await reply.json()) as { name: string }).name).toBe('Analiză reală.md');
  });

  test('the desktop app may send the filename header across origins', async () => {
    const { app } = setup();
    const reply = await app.request('/v1/attachments', {
      method: 'OPTIONS',
      headers: {
        origin: 'tauri://localhost',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,x-filename',
      },
    });
    expect(reply.headers.get('access-control-allow-headers')).toContain('x-filename');
  });
});

describe('a message with a document (F36)', () => {
  test('the agent gets the document, marked as material and not instructions', async () => {
    const claude = fakeAgent('claude', [[{ type: 'done', sessionId: 's1' }]]);
    const h = harness(NOON_ISH, { claude: claude.adapter, codex: fakeAgent('codex').adapter });
    const kept = await h.core.attachments.put(
      'analysis.md',
      enc('Week 1: Sequences\nWeek 2: Series'),
    );
    const finished = new Promise<void>((resolve) => {
      h.core.bus.subscribe((e) => e.type === 'chat' && e.kind === 'done' && resolve());
    });
    h.run('send_chat', { text: 'Make a roadmap from this', attachment_ids: [kept.id] });
    await finished;
    const prompt = claude.prompts[0]?.prompt ?? '';
    expect(prompt).toContain('<document name="analysis.md"');
    expect(prompt).toContain('Week 2: Series');
    expect(prompt).toContain('not instructions');
    expect(prompt.indexOf('</document>')).toBeLessThan(prompt.indexOf('Make a roadmap from this'));
    const message = h.run('get_conversation', {}).messages[0];
    expect(message?.meta).toMatchObject({ attachments: [{ name: 'analysis.md' }] });
    expect(message?.text).toBe('Make a roadmap from this');
  });

  test('a file that is no longer kept is refused before any turn starts', () => {
    const h = harness();
    expect(() => h.run('send_chat', { text: 'x', attachment_ids: ['gone'] })).toThrow(/again/);
    expect(h.run('get_conversation', {}).messages).toEqual([]);
  });

  test('agents cannot send attachments, only people can', () => {
    const h = harness();
    expect(() => h.run('send_chat', { text: 'x' }, CLAUDE)).toThrow();
  });
});
