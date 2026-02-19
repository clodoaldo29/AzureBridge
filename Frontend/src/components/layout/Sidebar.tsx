import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Target, CheckSquare, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils/cn';

const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Sprints', href: '/sprints', icon: Target },
    { name: 'Work Items', href: '/work-items', icon: CheckSquare },
    { name: 'RDA', href: '/rda', icon: FileText },
];

export function Sidebar() {
    const location = useLocation();
    const { sidebarCollapsed, setSidebarCollapsed } = useAppStore();

    const toggleSidebar = () => setSidebarCollapsed(!sidebarCollapsed);

    return (
        <aside
            className={cn(
                'fixed left-0 top-16 h-[calc(100vh-4rem)] bg-card border-r border-border transition-all duration-300',
                sidebarCollapsed ? 'w-16' : 'w-64'
            )}
        >
            <nav className="flex flex-col h-full">
                <div className="flex-1 px-3 py-4 space-y-1">
                    {navigation.map((item) => {
                        const isActive = location.pathname === item.href;
                        return (
                            <Link
                                key={item.name}
                                to={item.href}
                                className={cn(
                                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                                    isActive
                                        ? 'bg-blue-50 text-blue-600'
                                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                )}
                            >
                                <item.icon className="w-5 h-5 flex-shrink-0" />
                                {!sidebarCollapsed && <span>{item.name}</span>}
                            </Link>
                        );
                    })}
                </div>

                <div className="p-3 border-t border-border">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleSidebar}
                        className="w-full justify-center"
                    >
                        {sidebarCollapsed ? (
                            <ChevronRight className="w-5 h-5" />
                        ) : (
                            <ChevronLeft className="w-5 h-5" />
                        )}
                    </Button>
                </div>
            </nav>
        </aside>
    );
}
