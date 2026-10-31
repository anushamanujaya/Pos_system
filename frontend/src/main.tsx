import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { App } from '@/app/App';
import { refreshSession } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import '@/styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (n, e) =>
        n < 1 && (e as { status?: number }).status !== 404 && (e as { status?: number }).status !== 403,
    },
  },
});

// Silent session restore from the httpOnly refresh cookie
refreshSession().finally(() => useAuth.getState().setReady());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster position="top-right" richColors closeButton />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
