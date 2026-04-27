import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider, Toaster } from '@databricks/appkit-ui/react';
import { App } from './App';
import { I18nProvider } from './i18n';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, refetchOnWindowFocus: false },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
          <Toaster richColors closeButton position="bottom-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
