import '@sirius/ui/styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { connect } from './data/connect.ts';
import { ClientContext } from './data/queries.ts';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // SSE keeps everything fresh, so refetching on focus or a timer would be wasted work.
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

const client = await connect();

createRoot(root).render(
  <StrictMode>
    <ClientContext.Provider value={client}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ClientContext.Provider>
  </StrictMode>,
);
