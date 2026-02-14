.PHONY: help install dev build up down logs ps clean api-shell db-migrate db-studio test lint

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (Backend + Frontend)
	cd Backend && npm ci
	cd Frontend && npm ci

dev: ## Start development stack in background (build + watch stack)
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

build: ## Build all production images
	docker compose build

up: ## Start production stack in background (build + up)
	docker compose up -d --build

down: ## Stop all containers
	docker compose down

logs: ## Follow logs from all services
	docker compose logs -f

ps: ## Show container status
	docker compose ps

clean: ## Stop and remove containers/volumes/images
	docker compose down -v --remove-orphans

api-shell: ## Access API container shell
	docker compose exec api sh

db-migrate: ## Run database migrations
	cd Backend && npm run db:migrate

db-studio: ## Open Prisma Studio
	cd Backend && npm run db:studio

test: ## Run backend tests
	cd Backend && npm test

lint: ## Run linters
	cd Backend && npm run lint
	cd Frontend && npm run lint
