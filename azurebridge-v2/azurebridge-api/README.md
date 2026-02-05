# AzureBridge API

Backend API para o sistema AzureBridge - Dashboard e Relatórios do Azure DevOps.

## 🚀 Tecnologias

- Node.js 20 + TypeScript
- Fastify (Framework)
- Prisma ORM
- PostgreSQL (Supabase)
- Redis (Cache)
- Azure DevOps Node API
- Bull (Job Queue)

## 📦 Instalação
```bash
npm install
```

## ⚙️ Configuração

1. Copie `.env.example` para `.env`
2. Preencha as variáveis de ambiente
3. Execute as migrations do banco:
```bash
npm run db:migrate
```

## 🏃 Executar

### Desenvolvimento
```bash
npm run dev
```

### Produção
```bash
npm run build
npm start
```

## 🧪 Testes
```bash
npm test              # Todos os testes
npm run test:watch   # Watch mode
npm run test:e2e     # End-to-end
```

## 📚 Documentação da API

Acesse: http://localhost:3001/docs

## 🐳 Docker
```bash
docker build -t azurebridge-api .
docker run -p 3001:3001 azurebridge-api
```
