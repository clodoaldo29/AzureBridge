import { Bell, Search, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';

function getInitials(name: string): string {
    return name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join('');
}

export function Header() {
    const { user, logout } = useAuth();

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

                    {/* Avatar + menu do usuário */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                className="relative w-9 h-9 rounded-full p-0 bg-blue-100 hover:bg-blue-200 text-blue-700 font-semibold text-sm"
                            >
                                {user ? getInitials(user.displayName) : '?'}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            {user && (
                                <>
                                    <DropdownMenuLabel className="font-normal">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="font-semibold text-foreground text-sm">
                                                {user.displayName}
                                            </span>
                                            <span className="text-xs text-muted-foreground truncate">
                                                {user.email}
                                            </span>
                                        </div>
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                </>
                            )}
                            <DropdownMenuItem
                                onClick={logout}
                                className="text-destructive focus:text-destructive cursor-pointer"
                            >
                                <LogOut className="w-4 h-4 mr-2" />
                                Sair
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </header>
    );
}
