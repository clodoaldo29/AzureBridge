import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

function MicrosoftIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
        </svg>
    );
}

export function Login() {
    const { login, isAuthenticated, isLoading, error } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (isAuthenticated) {
            navigate('/', { replace: true });
        }
    }, [isAuthenticated, navigate]);

    return (
        <div className="min-h-screen bg-background flex items-center justify-center">
            <div className="w-full max-w-sm mx-4">
                <div className="bg-card border border-border rounded-2xl shadow-lg p-8 flex flex-col items-center gap-6">
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-md">
                            <span className="text-white font-bold text-2xl">AB</span>
                        </div>
                        <div className="text-center">
                            <h1 className="text-2xl font-bold text-foreground">AzureBridge</h1>
                            <p className="text-sm text-muted-foreground mt-1">
                                Dashboard Azure DevOps
                            </p>
                        </div>
                    </div>

                    <div className="w-full border-t border-border" />

                    <div className="w-full flex flex-col items-center gap-4">
                        <p className="text-sm text-center text-muted-foreground">
                            Faca login com sua conta Microsoft corporativa para continuar
                        </p>

                        <Button
                            onClick={login}
                            disabled={isLoading}
                            className="w-full gap-2 h-11"
                            variant="outline"
                        >
                            {isLoading ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <MicrosoftIcon />
                            )}
                            {isLoading ? 'Autenticando...' : 'Entrar com Microsoft'}
                        </Button>

                        {error && (
                            <p className="text-sm text-destructive text-center">
                                {error}
                            </p>
                        )}
                    </div>

                    <p className="text-xs text-muted-foreground text-center">
                        Acesso restrito a contas do dominio iRede
                    </p>
                </div>
            </div>
        </div>
    );
}
