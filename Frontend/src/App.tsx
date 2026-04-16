import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Toaster } from '@/components/ui/toaster';
import { ServerCheck } from '@/components/common/ServerCheck';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { Dashboard } from '@/pages/Dashboard';
import { Login } from '@/pages/Login';

const isRdaModuleEnabled = (import.meta.env.VITE_FEATURE_RDA_MODULE ?? 'false') === 'true';
const SprintHistory = lazy(() => import('@/pages/SprintHistory').then((module) => ({ default: module.SprintHistory })));
const Sprints = lazy(() => import('@/pages/Sprints').then((module) => ({ default: module.Sprints })));
const RDAGenerator = lazy(() => import('@/features/rda/pages/RDAGenerator').then((module) => ({ default: module.RDAGenerator })));

type PlaceholderPageProps = {
    title: string;
    description: string;
};

function PlaceholderPage({ title, description }: PlaceholderPageProps) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
            <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
            <p className="max-w-md text-sm text-muted-foreground">{description}</p>
        </div>
    );
}

function RouteLoader() {
    return (
        <div className="flex h-full min-h-[60vh] items-center justify-center text-muted-foreground">
            Carregando...
        </div>
    );
}

export default function App() {
    return (
        <ServerCheck>
            <Routes>
                {/* Rota pública de login */}
                <Route path="login" element={<Login />} />

                {/* Rotas protegidas — exigem autenticação */}
                <Route
                    element={
                        <ProtectedRoute>
                            <AppLayout />
                        </ProtectedRoute>
                    }
                >
                    <Route index element={<Dashboard />} />
                    <Route
                        path="historico"
                        element={
                            <Suspense fallback={<RouteLoader />}>
                                <SprintHistory />
                            </Suspense>
                        }
                    />
                    <Route
                        path="sprints"
                        element={
                            <Suspense fallback={<RouteLoader />}>
                                <Sprints />
                            </Suspense>
                        }
                    />
                    <Route
                        path="work-items"
                        element={
                            <PlaceholderPage
                                title="Work Items"
                                description="Estamos preparando esta visão para os itens de trabalho."
                            />
                        }
                    />
                    <Route
                        path="rda"
                        element={
                            isRdaModuleEnabled ? (
                                <Suspense fallback={<RouteLoader />}>
                                    <RDAGenerator />
                                </Suspense>
                            ) : (
                                <Navigate to="/" replace />
                            )
                        }
                    />
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <Toaster />
        </ServerCheck>
    );
}
