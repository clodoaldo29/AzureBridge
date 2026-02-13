import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Dashboard } from '@/pages/Dashboard';
import { Toaster } from '@/components/ui/toaster';
import { ServerCheck } from '@/components/common/ServerCheck';

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

export default function App() {
    return (
        <ServerCheck>
            <Routes>
                <Route element={<AppLayout />}>
                    <Route index element={<Dashboard />} />
                    <Route
                        path="sprints"
                        element={
                            <PlaceholderPage
                                title="Sprints"
                                description="Em breve você poderá acompanhar as sprints diretamente por aqui."
                            />
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
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <Toaster />
        </ServerCheck>
    );
}

