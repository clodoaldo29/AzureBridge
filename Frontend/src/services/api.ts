import axios from 'axios';

const apiUrl = import.meta.env.VITE_API_URL?.trim();
const resolvedApiUrl = apiUrl ? apiUrl.replace(/\/$/, '') : '';

export const api = axios.create({
    baseURL: resolvedApiUrl ? `${resolvedApiUrl}/api` : '/api',
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 30000,
});

// Request interceptor
api.interceptors.request.use(
    (config) => {
        // Adicionar token de autenticação se existir
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            // Redirecionar para login se não autenticado
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);
