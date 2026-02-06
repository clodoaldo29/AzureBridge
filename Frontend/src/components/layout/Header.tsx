import { Bell, Search, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useAppStore } from '@/stores/appStore';
import type { Project } from '@/types';

export function Header() {
    const { selectedProjectId, setSelectedProjectId } = useAppStore();

    // Fetch all projects
    const { data: projects } = useQuery<{ data: Project[] }>({
        queryKey: ['projects'],
        queryFn: async () => {
            const response = await api.get('/projects');
            return response.data;
        },
    });

    return (
        <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
            <div className="flex items-center justify-between h-16 px-6">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                            <span className="text-white font-bold text-sm">AB</span>
                        </div>
                        <h1 className="text-xl font-bold text-gray-900">AzureBridge</h1>
                    </div>

                    {/* Project Selector */}
                    <div className="ml-4">
                        <Select
                            value={selectedProjectId || ''}
                            onValueChange={(value: string) => setSelectedProjectId(value)}
                        >
                            <SelectTrigger className="w-[280px]">
                                <SelectValue placeholder="Selecione um projeto..." />
                            </SelectTrigger>
                            <SelectContent>
                                {projects?.data?.map((project) => (
                                    <SelectItem key={project.id} value={project.id}>
                                        {project.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                        <input
                            type="text"
                            placeholder="Buscar..."
                            className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
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
