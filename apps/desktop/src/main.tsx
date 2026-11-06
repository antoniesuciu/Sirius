import '@sirius/ui/styles.css';
import { ClientContext, registerQueuedOps, reportRefusal, setReachable } from '@sirius/client';
import { isUnreachable } from '@sirius/contracts';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { connect } from './data/connect.ts';
import { Pair } from './Pair.tsx';

/** A phone keeps what it last saw for this long, then starts fresh. */
const KEEP_OFFLINE_MS = 30 * 24 * 60 * 60 * 1000;
/** Change this when the shape of cached data changes, so an old copy is dropped. */
const CACHE_VERSION = 'v1';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // SSE keeps everything fresh, so refetching on focus or a timer would be wasted work.
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
  mutationCache: new MutationCache({
    onError: (error) => {
      if (!isUnreachable(error)) reportRefusal(error);
    },
  }),
});

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

const boot = await connect();

// Only the phone app needs this: the desktop serves its files from inside the binary.
if (
  window.isSecureContext &&
  'serviceWorker' in navigator &&
  !('__TAURI_INTERNALS__' in window) &&
  !import.meta.env.DEV &&
  !new URLSearchParams(window.location.search).has('fixtures')
) {
  void navigator.serviceWorker.register('./sw.js');
}

function phonePersister() {
  try {
    return createSyncStoragePersister({ storage: window.localStorage, key: 'sirius.cache' });
  } catch {
    return null;
  }
}

if (boot.kind === 'pair') {
  createRoot(root).render(
    <StrictMode>
      <Pair code={boot.code} />
    </StrictMode>,
  );
} else {
  // Before anything restores, so changes saved on the phone know how to send themselves.
  registerQueuedOps(queryClient, boot.client);
  setReachable(boot.reachable);
  const persister = boot.phone ? phonePersister() : null;
  const app = (
    <ClientContext.Provider value={boot.client}>
      <App phone={boot.phone} />
    </ClientContext.Provider>
  );
  createRoot(root).render(
    <StrictMode>
      {persister ? (
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister,
            maxAge: KEEP_OFFLINE_MS,
            buster: CACHE_VERSION,
            // Pending, not only paused: a change mid-retry when the phone closes must survive.
            dehydrateOptions: { shouldDehydrateMutation: (m) => m.state.status === 'pending' },
          }}
          onSuccess={() => {
            for (const mutation of queryClient.getMutationCache().getAll()) {
              if (mutation.state.status === 'pending') void mutation.continue().catch(() => {});
            }
          }}
        >
          {app}
        </PersistQueryClientProvider>
      ) : (
        <QueryClientProvider client={queryClient}>{app}</QueryClientProvider>
      )}
    </StrictMode>,
  );
}
