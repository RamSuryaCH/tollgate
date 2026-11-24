# Tollgate developer targets. Uses .venv/bin/python when the venv exists.
PY := $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)
TEST_DATABASE_URL ?= postgresql+asyncpg://tollgate:tollgate@127.0.0.1:5432/tollgate_test
TEST_REDIS_URL ?= redis://127.0.0.1:6379/1

.PHONY: setup up down test lint migrate seed dev dev-web

setup:
	python3 -m venv .venv
	.venv/bin/python -m pip install --upgrade pip
	.venv/bin/python -m pip install -e ".[dev]"

up:
	docker compose up --build -d

down:
	docker compose down

test:
	DEFAULT_PROVIDER=mock TEST_DATABASE_URL=$(TEST_DATABASE_URL) TEST_REDIS_URL=$(TEST_REDIS_URL) $(PY) -m pytest -q

lint:
	$(PY) -m ruff check src tests
	$(PY) -m ruff format --check src tests
	$(PY) -m mypy src

migrate:
	$(PY) -m alembic upgrade head

seed:
	$(PY) scripts/seed.py

dev:
	$(PY) -m uvicorn tollgate.main:app --reload --host 0.0.0.0 --port 8000

dev-web:
	npm --prefix web run dev
