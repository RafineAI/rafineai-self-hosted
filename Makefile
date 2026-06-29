# RafineAI Self-Hosted — common operations.
.PHONY: help setup up up-dev down logs ps migrate test test-gateway test-api build-panel

help:
	@echo "RafineAI — make targets:"
	@echo "  setup       Generate .env with auto-filled secrets (scripts/gen-env.sh)"
	@echo "  up          Start the stack (pre-built images)"
	@echo "  up-dev      Build from source and start"
	@echo "  down        Stop the stack"
	@echo "  logs        Tail all service logs"
	@echo "  ps          Show service status"
	@echo "  migrate     Apply DB migrations on demand (one-shot)"
	@echo "  test        Run gateway + api tests"

setup:
	./scripts/gen-env.sh

up: setup
	docker compose pull && docker compose up -d

up-dev: setup
	docker compose -f docker-compose.dev.yml up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

ps:
	docker compose ps

migrate:
	docker compose run --rm api python -m app.migrate_cli

test: test-gateway test-api

test-gateway:
	cd gateway && go vet ./... && go test -race ./...

test-api:
	cd api && pytest -q

build-panel:
	cd panel && npm install && npm run build
