FROM python:3.11-slim AS base
WORKDIR /srv

# System deps kept minimal; asyncpg & cryptography ship wheels.
COPY api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# App code and SQL migrations (the migration runner reads db/migrations).
COPY api/app ./app
COPY db ./db

ENV MIGRATIONS_DIR=db/migrations \
    API_PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${API_PORT}"]
