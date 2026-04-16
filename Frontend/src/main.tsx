import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { MsalProvider } from '@azure/msal-react';
import axios from 'axios';
import App from './App';
import { msalInstance } from './config/msal';
import { exchangeMicrosoftToken } from './services/auth.service';
import { useAppStore } from './stores/appStore';
import './styles/globals.css';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 55 * 60 * 1000,
            gcTime: 60 * 60 * 1000,
            retry: (failureCount, error) => {
                if (axios.isAxiosError(error)) {
                    const status = error.response?.status;
                    if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
                        return false;
                    }
                }
                return failureCount < 4;
            },
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
        },
    },
});

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Root element not found');
}

function renderApp() {
    ReactDOM.createRoot(rootElement!).render(
        <React.StrictMode>
            <MsalProvider instance={msalInstance}>
                <QueryClientProvider client={queryClient}>
                    <BrowserRouter>
                        <App />
                    </BrowserRouter>
                    <ReactQueryDevtools initialIsOpen={false} />
                </QueryClientProvider>
            </MsalProvider>
        </React.StrictMode>
    );
}

async function bootstrapApp() {
    try {
        await msalInstance.initialize();

        const redirectResult = await msalInstance.handleRedirectPromise();
        if (redirectResult?.account) {
            msalInstance.setActiveAccount(redirectResult.account);
        }

        if (redirectResult?.idToken) {
            const { token, user } = await exchangeMicrosoftToken(redirectResult.idToken);
            useAppStore.getState().setAuth(token, user);
        }
    } catch (error) {
        console.error('Falha ao inicializar autenticacao Microsoft:', error);
        useAppStore.getState().clearAuth();
    } finally {
        renderApp();
    }
}

void bootstrapApp();
