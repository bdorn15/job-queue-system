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

The `migrator` service runs `prisma migrate deploy` before any other service comes up. It runs on every `docker compose up`, not just the first — on subsequent starts it simply finds no pending migrations and exits 0.

Services available after startup:

| Service | URL |
|---|---|
| API Gateway | http://localhost:3000 |
| Auth Service | http://localhost:3002 |
| Job Service | http://localhost:3001 |
| Job Service Swagger | http://localhost:3001/docs |
| Auth Service Swagger | http://localhost:3002/docs |

The direct service ports (3001, 3002) and their Swagger docs are exposed for local development only — see [Known Limitations](#known-limitations).

### Local Development

```bash
# Install dependencies, then generate the Prisma client
pnpm install
pnpm db:generate

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

Requires [`jq`](https://jqlang.org/) to extract the token from the login response.

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
3. job-service creates a `Job` record in PostgreSQL (`PENDING`) **before** enqueuing it in Redis — deliberately in that order: if the enqueue fails, the row is still there and recoverable. The reverse order would leave a queued job whose data was never persisted — unrecoverable, since the payload only existed in the request
4. Worker picks up the job, updates status to `RUNNING`, executes it
5. On success: status → `COMPLETED`
6. On failure with retries remaining: status → `RETRYING`, BullMQ retries with exponential backoff
7. On final failure: status → `FAILED`

All state transitions are logged in `JobLog`.

## Known Limitations

This project prioritizes demonstrating queue mechanics and service boundaries over production hardening. Known gaps:

- **Dual write without a transaction.** The DB insert and the Redis enqueue (step 3 above) are two separate systems — a crash between them leaves an orphaned `PENDING` job that's never enqueued, and there's no reconciliation mechanism to detect or recover it. A periodic reconciliation job (re-enqueue stale `PENDING` rows) or a transactional outbox pattern would close this gap.
- **At-least-once delivery without idempotency.** BullMQ retries mean a job can execute more than once — e.g. the worker finishes the actual work but dies before the `COMPLETED` status update, BullMQ marks the job stalled, and it gets picked up and re-executed. Real handlers would need an idempotency key to make repeated execution safe.
- **Auth is duplicated across services.** Each service runs its own JWT guard rather than relying solely on the gateway, because the service ports (3001, 3002) are directly reachable and not just proxied. For production this means closing the direct ports and/or extracting the guard into a shared package.
- **`PrismaService` is duplicated per service** instead of living once in `@jqs/database`.
- **No refresh token.** The access token expires after 7 days with no rotation mechanism.
- **BullMQ version is pinned.** `attemptsMade` semantics differ between BullMQ v4 and v5, so the dependency is pinned rather than left on a floating range.

> **Note:** The worker simulates job execution — it does not perform any real work (no emails sent, no reports generated, etc.). The `name` and `payload` fields are logged and the job is marked as completed after a short artificial delay. This project demonstrates the infrastructure and queue mechanics, not domain-specific job logic.
