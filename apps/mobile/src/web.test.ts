import { describe, expect, test } from 'bun:test';
import { createContext, runInContext, runInNewContext } from 'node:vm';
import {
  bridgeScript,
  onLaptop,
  openTabScript,
  parseFromPage,
  spokenScript,
  TOKEN_KEY,
  webUrl,
} from './web.ts';

/** A page with just enough of a browser for the bridge: storage, and the WebView's channel. */
function page() {
  const posted: unknown[] = [];
  class Storage {
    data = new Map<string, string>();
    setItem(k: string, v: string) {
      this.data.set(k, String(v));
    }
    removeItem(k: string) {
      this.data.delete(k);
    }
    getItem(k: string) {
      return this.data.get(k) ?? null;
    }
  }
  const localStorage = new Storage();
  const sessionStorage = new Storage();
  // As in a browser, the page's global object is its window.
  const window = createContext({
    ReactNativeWebView: { postMessage: (m: string) => posted.push(JSON.parse(m)) },
    Storage,
    localStorage,
    sessionStorage,
  }) as Record<string, unknown>;
  window.window = window;
  const run = (code: string) => runInContext(code, window);
  return { posted, window, localStorage, sessionStorage, run };
}

describe('the bridge between the laptop page and the shell', () => {
  test('signs the page in with the shell token, before its own scripts run', () => {
    const p = page();
    p.run(bridgeScript('tok-1'));
    expect(p.localStorage.getItem(TOKEN_KEY)).toBe('tok-1');
    expect(p.posted).toEqual([]);
  });

  test('a token the page gets by pairing again reaches the shell, and so does losing it', () => {
    const p = page();
    p.run(bridgeScript('tok-1'));
    p.run(`localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, 'tok-2')`);
    p.run(`localStorage.setItem('sirius.theme', 'graphite')`);
    p.run(`sessionStorage.setItem(${JSON.stringify(TOKEN_KEY)}, 'not-ours')`);
    p.run(`localStorage.removeItem(${JSON.stringify(TOKEN_KEY)})`);
    expect(p.posted).toEqual([
      { type: 'token', token: 'tok-2' },
      { type: 'token', token: null },
    ]);
  });

  test('speech goes to the phone, and the page hears when each sentence ends', () => {
    const p = page();
    p.run(bridgeScript('t'));
    p.run(`
      var ended = [];
      var a = new SpeechSynthesisUtterance('Hello.'); a.lang = 'en-GB';
      a.onend = function () { ended.push('a'); };
      var b = new SpeechSynthesisUtterance('Bună.'); b.lang = 'ro-RO';
      b.onerror = function () { ended.push('b failed'); };
      speechSynthesis.speak(a); speechSynthesis.speak(b);
    `);
    expect(p.posted).toEqual([
      { type: 'speak', id: 1, text: 'Hello.', lang: 'en-GB' },
      { type: 'speak', id: 2, text: 'Bună.', lang: 'ro-RO' },
    ]);
    p.run(spokenScript(1, true));
    p.run(spokenScript(2, false));
    p.run(spokenScript(2, true)); // already answered: nothing more
    expect(p.run('ended')).toEqual(['a', 'b failed']);
    expect(p.run('speechSynthesis.getVoices().length')).toBe(0);
  });

  test('stopping drops what was still to be said', () => {
    const p = page();
    p.run(bridgeScript('t'));
    p.run(`
      var ended = 0;
      var u = new SpeechSynthesisUtterance('Long reply.'); u.onend = function () { ended++; };
      speechSynthesis.speak(u); speechSynthesis.cancel();
    `);
    p.run(spokenScript(1, true));
    expect(p.posted.at(-1)).toEqual({ type: 'cancel' });
    expect(p.run('ended')).toBe(0);
  });

  test('a notification tap opens its tab the way the service worker does', () => {
    const seen: unknown[] = [];
    class MessageEvent {
      constructor(
        public type: string,
        public init: { data: unknown },
      ) {}
    }
    const navigator = {
      serviceWorker: { dispatchEvent: (e: MessageEvent) => seen.push(e.init.data) },
    };
    runInNewContext(openTabScript('sirius'), { navigator, MessageEvent });
    expect(seen).toEqual([{ type: 'open-tab', tab: 'sirius' }]);
  });
});

describe('messages from the page', () => {
  test('only the three known shapes are acted on', () => {
    expect(parseFromPage('{"type":"speak","id":3,"text":"Hi","lang":"en-GB"}')).toEqual({
      type: 'speak',
      id: 3,
      text: 'Hi',
      lang: 'en-GB',
    });
    expect(parseFromPage('{"type":"cancel"}')).toEqual({ type: 'cancel' });
    expect(parseFromPage('{"type":"token","token":null}')).toEqual({ type: 'token', token: null });
    expect(parseFromPage('{"type":"token","token":5}')).toBeNull();
    expect(parseFromPage('{"type":"speak","text":"no id"}')).toBeNull();
    expect(parseFromPage('{"type":"eval","code":"x"}')).toBeNull();
    expect(parseFromPage('not json')).toBeNull();
  });

  test('a notification can open the app on a tab', () => {
    expect(webUrl('https://laptop.ts.net', 'plan')).toBe('https://laptop.ts.net/?tab=plan');
    expect(webUrl('https://laptop.ts.net')).toBe('https://laptop.ts.net/');
  });

  test('only the laptop loads inside the app, where the bridge hands out the token', () => {
    const laptop = 'https://laptop.ts.net';
    expect(onLaptop('https://laptop.ts.net/?tab=plan', laptop)).toBe(true);
    expect(onLaptop('https://laptop.ts.net.evil.com/', laptop)).toBe(false);
    expect(onLaptop('http://laptop.ts.net/', laptop)).toBe(false);
    expect(onLaptop('not a url', laptop)).toBe(false);
  });
});
