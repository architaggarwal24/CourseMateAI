.PHONY: dev backend frontend install test lint

dev: ## Start both backend and frontend (requires two terminals or use with &)
	@echo "Starting backend on :8000 and frontend on :3000"
	$(MAKE) -j2 backend frontend

backend: ## Start the FastAPI backend
	cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000

frontend: ## Start the Next.js frontend
	cd frontend && npm run dev

install: ## Install all dependencies
	cd backend && pip install -r requirements.txt
	cd frontend && npm install

test: ## Run backend tests
	cd backend && pytest -v

lint: ## Run ruff linter on backend
	cd backend && ruff check .

setup: ## First-time setup: copy env files and install deps
	@[ -f backend/.env ] || cp backend/.env.example backend/.env && echo "Created backend/.env — add your JWT_SECRET"
	@[ -f frontend/.env.local ] || cp frontend/.env.local.example frontend/.env.local && echo "Created frontend/.env.local"
	$(MAKE) install

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
