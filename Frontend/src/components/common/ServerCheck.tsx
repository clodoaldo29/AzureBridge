import { useEffect, useState } from 'react';
import { Loader2, ServerCrash } from 'lucide-react';

interface ServerCheckProps {
    children: React.ReactNode;
}

export function ServerCheck({ children }: ServerCheckProps) {
    const [isHealthy, setIsHealthy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let intervalId: NodeJS.Timeout;
        let attempts = 0;
        const maxAttempts = 120; // 2 minute timeout given DB might be slow

        const checkHealth = async () => {
            try {
                // Usa fetch nativo para evitar interceptors do axios e reduzir ruído no console
                const response = await fetch('/api/health');
                if (response.ok) {
                    setIsHealthy(true);
                    setError(null);
                } else {
                    throw new Error('Server starting...');
                }
            } catch (err) {
                attempts++;
                if (attempts >= maxAttempts) {
                    setError('O servidor está demorando muito para responder. Verifique se o backend está rodando.');
                }
            }
        };

        checkHealth();

        intervalId = setInterval(() => {
            if (!isHealthy) {
                checkHealth();
            }
        }, 2000); // Polling a cada 2s é suficiente

        return () => {
            clearInterval(intervalId);
        };
    }, [isHealthy]);

    if (isHealthy) {
        return <>{children}</>;
    }

    return (
        <div className="flex h-screen w-full flex-col items-center justify-center bg-background text-muted-foreground">
            <div className="w-full max-w-md p-8 flex flex-col items-center">
                {error ? (
                    <div className="flex flex-col items-center gap-4 text-center">
                        <ServerCrash className="h-16 w-16 text-red-500 mb-2" />
                        <h2 className="text-2xl font-bold text-foreground">Ops! O sistema está offline</h2>
                        <p className="text-muted-foreground">{error}</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="mt-6 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-all shadow-md active:scale-95"
                        >
                            Tentar Novamente
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-6 w-full">
                        <div className="relative h-24 w-24">
                            <Loader2 className="h-24 w-24 animate-spin text-blue-600 opacity-20" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
                            </div>
                        </div>
                        <div className="text-center space-y-2">
                            <h2 className="text-2xl font-bold text-foreground">AzureBridge</h2>
                            <p className="text-lg font-medium text-blue-600 animate-pulse">Conectando ao Servidor...</p>
                            <div className="w-48 h-1.5 bg-gray-100 rounded-full overflow-hidden mt-4 mx-auto">
                                <div className="h-full bg-blue-600 animate-progress-indeterminate"></div>
                            </div>
                            <p className="text-xs text-muted-foreground mt-6">Aguardando inicialização dos serviços em nuvem.</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

