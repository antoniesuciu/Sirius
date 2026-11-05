#!/usr/bin/env bun
/**
 * A stand-in for the `claude` CLI, so live tests see a real core stream a reply the way
 * Claude does: several deltas, a tool call in the middle, and a trailing newline that the
 * core trims when it stores the message, and a pause before the end, as the CLI takes.
 */
const [first] = process.argv.slice(2);
if (first === 'auth') {
  console.log('{"loggedIn": true}');
  process.exit(0);
}
const line = (o: unknown) => console.log(JSON.stringify(o));
const text = (t: string) =>
  line({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } },
  });
line({ type: 'system', subtype: 'init', mcp_servers: [{ name: 'sirius', status: 'connected' }] });
for (const t of ['Let me ', 'check. ']) {
  text(t);
  await Bun.sleep(60);
}
line({
  type: 'stream_event',
  event: {
    type: 'content_block_start',
    content_block: { type: 'tool_use', name: 'mcp__sirius__get_today' },
  },
});
await Bun.sleep(150);
for (const t of ['You have ', 'three things ', 'today.', '\n']) {
  text(t);
  await Bun.sleep(60);
}
// The real CLI takes a while to finish after its last word (Codex up to ~9 s).
await Bun.sleep(2500);
line({ type: 'result', subtype: 'success', is_error: false, session_id: 'fake-session' });

export {};
