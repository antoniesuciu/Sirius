/**
 * The web phone app inside the native shell (ADR 0014): the laptop serves the UI, so the look,
 * the animations and voice are the web app's own; the shell adds what a browser tab cannot,
 * notifications, the widget and background sync. These are the few seams between the two.
 */

/** Where the web app keeps a paired phone's token (apps/desktop/src/data/connect.ts). */
export const TOKEN_KEY = 'sirius.phone-token';

export type FromPage =
  | { type: 'speak'; id: number; text: string; lang: string }
  | { type: 'cancel' }
  | { type: 'alive' }
  | { type: 'token'; token: string | null };

export function webUrl(address: string, tab?: string): string {
  return tab ? `${address}/?tab=${encodeURIComponent(tab)}` : `${address}/`;
}

/** The home-screen wolf's link: open Sirius, already listening. */
export const LISTEN_URL = 'sirius://listen';
export const isListenUrl = (url: string | null | undefined): boolean =>
  url?.split(/[/?#]/)[2] === 'listen';

/** Whether a navigation stays on the laptop. A prefix test would let laptop.ts.net.evil.com in. */
export function onLaptop(url: string, address: string): boolean {
  try {
    return new URL(url).origin === new URL(address).origin;
  } catch {
    return false;
  }
}

/**
 * Runs before the page's own scripts. It signs the page in with the shell's token, reports a
 * token the page gets by pairing again, and stands in for speechSynthesis: Android's WebView
 * has none, so speech goes to the phone's own voice through the shell.
 *
 * It also sizes the space under the tab bar. The page fills the screen down to the bottom edge,
 * so the bar would reach into Android's gesture area: the space under it is the full inset, so
 * the whole bar sits above the gesture line (2026-11-06).
 */
export function bridgeScript(token: string, bottomInset = 0): string {
  const tabPad = Math.max(6, Math.round(bottomInset));
  return `(function () {
  try { document.documentElement.style.setProperty('--shell-tab-pad', '${tabPad}px'); } catch (e) {}
  var KEY = ${JSON.stringify(TOKEN_KEY)};
  var post = function (m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var setItem = Storage.prototype.setItem;
  var removeItem = Storage.prototype.removeItem;
  try { setItem.call(localStorage, KEY, ${JSON.stringify(token)}); } catch (e) {}
  Storage.prototype.setItem = function (k, v) {
    setItem.call(this, k, v);
    if (this === localStorage && k === KEY) post({ type: 'token', token: String(v) });
  };
  Storage.prototype.removeItem = function (k) {
    removeItem.call(this, k);
    if (this === localStorage && k === KEY) post({ type: 'token', token: null });
  };

  var waiting = {};
  var next = 0;
  function Utterance(text) {
    this.text = text || ''; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1;
    this.volume = 1; this.onstart = null; this.onend = null; this.onerror = null;
  }
  var synth = {
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    speak: function (u) { var id = ++next; waiting[id] = u; post({ type: 'speak', id: id, text: u.text, lang: u.lang }); },
    cancel: function () { waiting = {}; post({ type: 'cancel' }); },
    getVoices: function () { return []; },
    pause: function () {}, resume: function () {},
    addEventListener: function () {}, removeEventListener: function () {}
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = Utterance;
  window.__siriusSpoken = function (id, ok) {
    var u = waiting[id];
    delete waiting[id];
    var done = u && (ok ? u.onend : u.onerror);
    if (done) done.call(u, { type: ok ? 'end' : 'error', utterance: u });
  };
})();
true;`;
}

/**
 * Back on screen: the page should look for the laptop now, as a browser tab does on its
 * `online` event. A WebView never sees a tab come back, and its timers may have slept, so its
 * stream would wait out a backoff of up to 30 s before the queued changes go (2026-11-06).
 */
export const RESUME_SCRIPT = `window.dispatchEvent(new Event('online'));
window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'alive' }));
true;`;

/** A tapped notification while the app is open: the same message the service worker sends. */
export function openTabScript(tab: string): string {
  return `(function () {
  var data = { type: 'open-tab', tab: ${JSON.stringify(tab)} };
  if (navigator.serviceWorker) navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: data }));
})();
true;`;
}

export function spokenScript(id: number, ok: boolean): string {
  return `window.__siriusSpoken && window.__siriusSpoken(${Math.trunc(id)}, ${ok}); true;`;
}

/** Messages come from the laptop's page: anything else is ignored, not trusted. */
export function parseFromPage(raw: string): FromPage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m.type === 'cancel') return { type: 'cancel' };
  if (m.type === 'alive') return { type: 'alive' };
  if (m.type === 'speak' && typeof m.id === 'number' && typeof m.text === 'string') {
    return {
      type: 'speak',
      id: m.id,
      text: m.text.slice(0, 4000),
      lang: typeof m.lang === 'string' ? m.lang : '',
    };
  }
  if (m.type === 'token' && (m.token === null || typeof m.token === 'string')) {
    return { type: 'token', token: m.token };
  }
  return null;
}
