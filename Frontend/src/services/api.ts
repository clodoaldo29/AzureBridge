import axios from 'axios';
import { useAppStore } from '@/stores/appStore';

const AUTH_TOKEN_KEY = 'azurebridge-auth-token';

const apiUrl = import.meta.env.VITE_API_URL?.trim();
const resolvedApiUrl = apiUrl ? apiUrl.replace(/\/$/, '') : '';

export const api = axios.create({
    baseURL: resolvedApiUrl ? `${resolvedApiUrl}/api` : '/api',
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 30000,
});

// Interceptor de requisição — injeta o JWT em todas as chamadas
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem(AUTH_TOKEN_KEY);
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Interceptor de resposta — redireciona para login em caso de 401
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            // Limpar estado de auth antes de redirecionar
            useAppStore.getState().clearAuth();
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);
