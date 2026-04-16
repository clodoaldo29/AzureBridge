import { api } from './api';
import { AuthUser } from '@/stores/appStore';

interface ExchangeTokenResponse {
    success: true;
    data: {
        token: string;
        user: AuthUser;
    };
}

/**
 * Envia o ID token Microsoft para o backend e recebe o JWT da aplicação.
 */
export async function exchangeMicrosoftToken(idToken: string): Promise<{ token: string; user: AuthUser }> {
    const response = await api.post<ExchangeTokenResponse>('/auth/microsoft', { idToken });
    return response.data.data;
}
