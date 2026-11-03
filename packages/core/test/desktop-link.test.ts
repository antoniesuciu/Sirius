import { describe, expect, test } from 'vitest';
import { DesktopLink } from '../src/desktopLink.ts';
import { createApp } from '../src/http/app.ts';
import { harness } from './harness.ts';

const GRACE = 20;
const after = (ms: number) => Bun.sleep(ms);

function setup() {
  let gone = 0;
  return { link: new DesktopLink(() => gone++, GRACE), gone: () => gone };
}

describe('the core follows the desktop app', () => {
  test('stops once the app has gone and stayed gone', async () => {
    const { link, gone } = setup();
    const detach = link.attach();
    await after(GRACE * 2);
    expect(gone()).toBe(0);
    detach();
    await after(GRACE * 2);
    expect(gone()).toBe(1);
  });

  test('a page reload inside the grace period changes nothing', async () => {
    const { link, gone } = setup();
    link.attach()();
    link.attach();
    await after(GRACE * 2);
    expect(gone()).toBe(0);
  });

  test('never stops if no app ever connected, as on a login without the window', async () => {
    const { gone } = setup();
    await after(GRACE * 2);
    expect(gone()).toBe(0);
  });

  test('one of two connections closing is not the app leaving', async () => {
    const { link, gone } = setup();
    const first = link.attach();
    link.attach();
    first();
    await after(GRACE * 2);
    expect(gone()).toBe(0);
  });
});

describe('who counts as the desktop app', () => {
  const open = async (client?: string) => {
    let attached = 0;
    const desktopLink = {
      attach: () => {
        attached++;
        return () => {};
      },
    } as unknown as DesktopLink;
    const app = createApp(harness().core, { token: 't', mode: 'local', version: 'x', desktopLink });
    const response = await app.request('/v1/events', {
      headers: { authorization: 'Bearer t', ...(client ? { 'x-sirius-client': client } : {}) },
    });
    await response.body?.cancel();
    return attached;
  };

  test('the desktop app does', async () => {
    expect(await open('desktop')).toBe(1);
  });

  test('a browser or the voice service does not', async () => {
    expect(await open()).toBe(0);
    expect(await open('voice-service')).toBe(0);
  });

  test('the app may send its header across origins', async () => {
    const app = createApp(harness().core, { token: 't', mode: 'local', version: 'x' });
    const response = await app.request('/v1/events', {
      method: 'OPTIONS',
      headers: {
        origin: 'tauri://localhost',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'x-sirius-client',
      },
    });
    expect(response.headers.get('access-control-allow-headers')).toContain('x-sirius-client');
  });
});

describe('a paired phone keeps the laptop serving (ADR 0009, amended)', () => {
  test('the app leaving does not stop the core while a phone needs it', async () => {
    let gone = 0;
    let phonePaired = true;
    const link = new DesktopLink(
      () => gone++,
      GRACE,
      () => phonePaired,
    );
    link.attach()();
    await after(GRACE * 2);
    expect(gone).toBe(0);

    phonePaired = false;
    link.attach()();
    await after(GRACE * 2);
    expect(gone).toBe(1);
  });
});
