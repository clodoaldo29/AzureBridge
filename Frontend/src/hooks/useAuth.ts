import { useState } from 'react';
import { useMsal, useIsAuthenticated } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { loginRequest } from '@/config/msal';
import { useAppStore } from '@/stores/appStore';

let loginInFlight = false;

export function useAuth() {
    const { instance, inProgress } = useMsal();
    const { authUser, isAuthenticated, clearAuth } = useAppStore();
    const isMsalAuthenticated = useIsAuthenticated();
    const [error, setError] = useState<string | null>(null);

    const isLoading = inProgress !== InteractionStatus.None;

    const login = async () => {
        if (loginInFlight || inProgress !== InteractionStatus.None) {
            return;
        }

        setError(null);
        loginInFlight = true;
        try {
            await instance.loginRedirect(loginRequest);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Erro ao fazer login';
            if (message.includes('user_cancelled')) {
                return;
            }
            setError(message);
        } finally {
            loginInFlight = false;
        }
    };

    const logout = async () => {
        clearAuth();
        try {
            await instance.logoutRedirect({
                postLogoutRedirectUri: window.location.origin,
            });
        } catch {
            // O estado local ja foi limpo antes do redirect.
        }
    };

    return {
        login,
        logout,
        isAuthenticated,
        isLoading,
        user: authUser,
        error,
        isMsalAuthenticated,
    };
}
