.PHONY: help install dev build up down logs clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	cd azurebridge-api && npm install
	cd azurebridge-web && npm install

dev: ## Start development environment
	docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

build: ## Build all containers
	docker-compose build

up: ## Start production environment
	docker-compose up -d

down: ## Stop all containers
	docker-compose down

logs: ## Show logs
	docker-compose logs -f

clean: ## Clean all containers and volumes
	docker-compose down -v
	rm -rf azurebridge-api/node_modules
	rm -rf azurebridge-web/node_modules
	rm -rf azurebridge-api/dist
	rm -rf azurebridge-web/dist

api-shell: ## Access API container shell
	docker-compose exec api sh

db-migrate: ## Run database migrations
	cd azurebridge-api && npm run db:migrate

db-studio: ## Open Prisma Studio
	cd azurebridge-api && npm run db:studio

test: ## Run tests
	cd azurebridge-api && npm test

lint: ## Run linter
	cd azurebridge-api && npm run lint
	cd azurebridge-web && npm run lint
