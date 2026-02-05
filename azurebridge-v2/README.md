# AzureBridge

Sistema completo de visualização e relatórios para Azure DevOps.

## 🚀 Quick Start

### 1. Configuração
```bash
# Clone o repositório
git clone <repo-url> AzureBridge
cd AzureBridge

# Copie e configure as variáveis de ambiente
cp .env.example .env
# Edite .env com suas credenciais

# Instale dependências
make install
```

### 2. Desenvolvimento
```bash
# Inicie o ambiente de desenvolvimento
make dev

# Acesse:
# - Frontend: http://localhost:5173
# - Backend: http://localhost:3001
# - Redis: localhost:6379
```

### 3. Produção
```bash
# Build
make build

# Start
make up

# Acesse: http://localhost
```

## 📚 Documentação

- [Backend API](./azurebridge-api/README.md)
- [Frontend Web](./azurebridge-web/README.md)

## 🛠️ Comandos Úteis
```bash
make help        # Ver todos os comandos
make logs        # Ver logs
make down        # Parar containers
make clean       # Limpar tudo
make db-migrate  # Rodar migrations
make test        # Rodar testes
```

## 🏗️ Estrutura
````
AzureBridge/
├── azurebridge-api/      # Backend (Node.js + TypeScript)
├── azurebridge-web/      # Frontend (React + TypeScript)
├── docker-compose.yml    # Produção
└── docker-compose.dev.yml # Desenvolvimento
````

## 📦 Stack

- **Backend:** Node.js 20, TypeScript, Fastify, Prisma, PostgreSQL
- **Frontend:** React 18, TypeScript, Vite, TailwindCSS, shadcn/ui
- **Cache:** Redis 7
- **Database:** PostgreSQL 16 (Supabase)
- **DevOps:** Docker, Docker Compose

## 📄 License

MIT
