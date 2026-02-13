import { Bell, Search, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
export function Header() {
    return (
        <header className="bg-card border-b border-border sticky top-0 z-50">
            <div className="flex items-center justify-between h-16 px-6">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                            <span className="text-white font-bold text-sm">AB</span>
                        </div>
                        <h1 className="text-xl font-bold text-foreground">AzureBridge</h1>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                        <input
                            type="text"
                            placeholder="Buscar..."
                            className="pl-10 pr-4 py-2 border border-input bg-background rounded-lg focus:outline-none focus:ring-2 focus:ring-ring w-64 text-foreground"
                        />
                    </div>
                    <Button variant="ghost" size="icon">
                        <Bell className="w-5 h-5" />
                    </Button>
                    <Button variant="ghost" size="icon">
                        <User className="w-5 h-5" />
                    </Button>
                </div>
            </div>
        </header>
    );
}
