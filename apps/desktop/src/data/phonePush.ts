/**
 * Turning on notifications on the phone (F39). The phone subscribes with the laptop's public
 * key and hands the subscription to the core, which then encrypts every notification for it.
 * Notifications still come from the laptop, so they need it awake, as everything else does.
 */
import type { SiriusClient } from '@sirius/contracts';
import { useCallback, useEffect, useState } from 'react';

export type PushState = 'unsupported' | 'off' | 'on' | 'blocked';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

const keyBytes = (key: string) => {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => {
  if (!a || a.byteLength !== b.length) return false;
  const view = new Uint8Array(a);
  return view.every((byte, i) => byte === b[i]);
};

/** Subscribes, or refreshes a subscription made for another key, and tells the core. */
async function subscribe(client: SiriusClient): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const key = keyBytes(await client.push.key());
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  const json = subscription.toJSON() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
  await client.push.subscribe({ endpoint: json.endpoint, keys: json.keys });
}

export function usePhonePush(client: SiriusClient, enabled: boolean) {
  const initial = (): PushState => {
    if (!enabled || !pushSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    return Notification.permission === 'granted' ? 'on' : 'off';
  };
  const [state, setState] = useState<PushState>(initial);
  const [error, setError] = useState<string | null>(null);

  // Already allowed: make sure the laptop knows this phone, for example after pairing again.
  useEffect(() => {
    if (state === 'on') void subscribe(client).catch(() => {});
  }, [client, state]);

  const turnOn = useCallback(async () => {
    setError(null);
    const answer = await Notification.requestPermission();
    if (answer !== 'granted') {
      setState(answer === 'denied' ? 'blocked' : 'off');
      return;
    }
    try {
      await subscribe(client);
      setState('on');
    } catch {
      setError("Couldn't turn notifications on. Try again when the laptop is in reach.");
    }
  }, [client]);

  return { state, error, turnOn };
}

/** A tap on a notification asks the open app to show a tab. */
export function useOpenTabRequests(onTab: (tab: string) => void): void {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const listen = (event: MessageEvent) => {
      const data = event.data as { type?: string; tab?: string } | null;
      if (data?.type === 'open-tab' && data.tab) onTab(data.tab);
    };
    navigator.serviceWorker.addEventListener('message', listen);
    return () => navigator.serviceWorker.removeEventListener('message', listen);
  }, [onTab]);
}
