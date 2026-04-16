import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';

interface ProtectedRouteProps {
    children: ReactNode;
}

/**
 * Protege rotas que exigem autenticação.
 * Redireciona para /login se o usuário não estiver autenticado.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
    const isAuthenticated = useAppStore((state) => state.isAuthenticated);

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    return <>{children}</>;
}
