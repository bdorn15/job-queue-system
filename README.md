# Job Queue System

A distributed job queue system built as a pnpm monorepo. Jobs are created via a REST API, persisted in PostgreSQL, queued in Redis via BullMQ, and processed asynchronously by a worker service. All services are containerized with Docker.

## Architecture

```
                    ┌─────────────────┐
                    │   API Gateway   │  :3000
                    │  (rate limit,   │
                    │   CORS, morgan) │
                    └────────┬────────┘
                             │ reverse proxy
               ┌─────────────┴──────────────┐
               │                            │
               ▼                            ▼
    ┌─────────────────┐           ┌──────────────────┐
    │  Auth Service   │  :3002    │   Job Service    │  :3001
    │  POST /register │           │   POST /jobs     │
    │  POST /login    │           │   GET  /jobs     │
    │  → JWT token    │           │   GET  /jobs/:id │
    └─────────────────┘           │   DELETE /jobs/:id│
                                  └────────┬─────────┘
                                           │ enqueue
                                           ▼
                                    ┌─────────────┐
                                    │    Redis    │
                                    │   (BullMQ)  │
                                    └──────┬──────┘
                                           │ consume
                                           ▼
                                    ┌─────────────┐
                                    │   Worker    │
                                    │  (BullMQ    │
                                    │  processor) │
                                    └─────────────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │  PostgreSQL  │
                                    │  (Prisma)   │
                                    └─────────────┘
```

## Monorepo Structure

```
apps/
  api-gateway/   — reverse proxy with rate limiting, CORS, logging (port 3000)
  auth-service/  — JWT authentication: register + login (port 3002)
  job-service/   — REST API for creating and managing jobs (port 3001)
  worker/        — BullMQ processor that executes queued jobs
packages/
  database/      — shared Prisma client (@jqs/database)
```

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS |
| Queue | BullMQ + Redis |
| Database | PostgreSQL + Prisma |
| Auth | JWT (HS256) |
| Validation | Zod |
| API Docs | Swagger / OpenAPI |
| Containerization | Docker + Docker Compose |
| Package manager | pnpm workspaces |

## Data Model

**User** — email/password authentication, owns jobs

**Job** — tracks the full lifecycle of a queued task:
- `status`: `PENDING → RUNNING → COMPLETED / FAILED / RETRYING`
- `priority`: `LOW / NORMAL / HIGH`
- `runAt`: schedule a job for future execution
- `attempts` / `maxAttempts`: automatic retry with exponential backoff
- `payload`: arbitrary JSON passed to the worker

**JobLog** — structured log entries attached to a job

## Getting Started

### Prerequisites

- Docker + Docker Compose
- Node.js 20+ and pnpm (for local development)

### Run with Docker

```bash
# Copy environment file and adjust values if needed
cp .env.example .env   # or edit .env directly

# Build images and start all services
docker compose up --build
```

On first start, the `migrator` service automatically runs `prisma migrate deploy` before any other service comes up. Subsequent starts skip this if the DB is already up to date.

Services available after startup:

| Service | URL |
|---|---|
| API Gateway | http://localhost:3000 |
| Auth Service | http://localhost:3002 |
| Job Service | http://localhost:3001 |
| Job Service Swagger | http://localhost:3001/docs |
| Auth Service Swagger | http://localhost:3002/docs |

### Local Development

```bash
# Install dependencies
pnpm install

# Start infrastructure (postgres + redis)
docker compose up postgres redis -d

# Set DATABASE_URL in apps/*/. env files to use localhost instead of Docker DNS
# Then start all services with hot reload
pnpm dev
```

## Environment Variables

The root `.env` is read by Docker Compose. Copy and adjust as needed:

```env
POSTGRES_USER=jqs
POSTGRES_PASSWORD=jqs_password
POSTGRES_DB=jqs_db
JWT_SECRET=change-me-in-production
```

Each service also reads its own `.env` for local development (not used in Docker).

## API Overview

All job endpoints require a `Bearer` token from the login response.

### Auth

```
POST /auth/register   { email, password }         → 201
POST /auth/login      { email, password }         → { accessToken }
```

### Jobs

```
POST   /jobs          { name, payload, priority?, runAt?, maxAttempts? }  → Job
GET    /jobs                                                               → Job[]
GET    /jobs/:id                                                           → Job + logs
DELETE /jobs/:id                                                           → Job
```

### Example

```bash
# Register and login
curl -s -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"password123"}'

TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"password123"}' \
  | jq -r '.accessToken')

# Create a job
curl -s -X POST http://localhost:3000/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"send-email","payload":{"to":"user@example.com"},"priority":"HIGH"}'
```

A Postman collection is included at `postman-collection.json` — the login request automatically saves the token to a collection variable.

## Useful Commands

```bash
pnpm install              # install all workspace dependencies
pnpm dev                  # start all services with hot reload (parallel)
pnpm build                # build all services

pnpm db:generate          # regenerate Prisma client after schema changes
pnpm db:migrate           # run migrations (dev mode, interactive)
pnpm db:studio            # open Prisma Studio

docker compose up --build         # rebuild and start everything
docker compose up postgres redis  # start infrastructure only
docker compose logs -f worker     # follow worker logs
```

## Job Flow

1. Client sends `POST /jobs` with a JWT token to the gateway
2. Gateway proxies to job-service, which validates the token
3. job-service creates a `Job` record in PostgreSQL (`PENDING`) and enqueues it in Redis
4. Worker picks up the job, updates status to `RUNNING`, executes it
5. On success: status → `COMPLETED`
6. On failure with retries remaining: status → `RETRYING`, BullMQ retries with exponential backoff
7. On final failure: status → `FAILED`

All state transitions are logged in `JobLog`.

> **Note:** The worker simulates job execution — it does not perform any real work (no emails sent, no reports generated, etc.). The `name` and `payload` fields are logged and the job is marked as completed after a short artificial delay. This project demonstrates the infrastructure and queue mechanics, not domain-specific job logic.
