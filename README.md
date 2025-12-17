# RFQ Automation

AI Agent Layer for processing Request for Quote (RFQ) emails through a pipeline of specialized agents.

## Overview

RFQ Automation is a TypeScript-based system that processes incoming RFQ emails through 6 specialized AI agents. Each agent performs atomic operations with full audit trails, human-in-the-loop capabilities, and checkpoint-based resume functionality.

## Features

- **6-Agent Pipeline**: Intake, Missing Info, Duplicate Detection, Prioritization, MTO, Auto-Quote
- **Event Sourcing**: Full audit trail with immutable events for every state change
- **Human-in-the-Loop**: Agents can pause for human intervention and resume after updates
- **Checkpoint Resume**: Resume from any point in the pipeline
- **Replay Capability**: Re-execute from any agent with preserved state
- **Queue-Based Architecture**: BullMQ for horizontal scaling
- **Object Storage**: MinIO for email attachments

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           EXECUTION LAYER                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  Intake  │──│ Missing  │──│Duplicate │──│ Priority │──...       │
│  │  Worker  │  │  Info    │  │  Check   │  │          │            │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    MESSAGE BROKER (BullMQ/Redis)                    │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │
│  │intake  │ │missing │ │dup    │ │priority│ │  mto   │ │ quote  │ │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         PERSISTENCE LAYER                           │
│         PostgreSQL              Redis               MinIO           │
│         (Executions,            (Queue State,       (Attachments)   │
│          Events,                 Caching)                           │
│          Snapshots)                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

## Agent Pipeline

| # | Agent | Purpose |
|---|-------|---------|
| 1 | **Intake** | Parse incoming RFQ emails and extract structured data |
| 2 | **Missing Info** | Identify missing information and generate clarification requests |
| 3 | **Duplicate** | Detect duplicate or similar RFQ requests |
| 4 | **Prioritization** | Classify complexity and assign priority |
| 5 | **MTO** | Generate Material Take-Off drafts |
| 6 | **Auto-Quote** | Generate quotes for low/medium complexity requests |

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 18+ |
| Language | TypeScript 5.x |
| AI | Anthropic SDK |
| Message Queue | BullMQ |
| Database | PostgreSQL 16 |
| ORM | Prisma |
| Cache/Queue Backend | Redis 7 |
| Object Storage | MinIO |
| API Framework | Fastify 5.x |
| Prompt Templates | Handlebars |
| Validation | Zod |
| Logging | Pino |

## Prerequisites

- Node.js 18+
- Docker and Docker Compose
- pnpm (recommended) or npm

## Quick Start

```bash
# 1. Clone and install dependencies
git clone <repository>
cd rfq-automation
pnpm install

# 2. Start infrastructure (PostgreSQL, Redis, MinIO)
docker-compose up -d

# 3. Set up environment
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY

# 4. Generate Prisma client and run migrations
pnpm db:generate
pnpm db:migrate:dev

# 5. Start development server (API)
pnpm dev:api

# 6. Start workers (in separate terminal)
pnpm dev:workers

# 7. View API documentation
# Open http://localhost:3000/docs in your browser
```

## API Documentation

Interactive API documentation is available via Swagger UI:

- **Swagger UI**: http://localhost:3000/docs
- **OpenAPI JSON**: http://localhost:3000/docs/json
- **OpenAPI YAML**: http://localhost:3000/docs/yaml

The documentation includes:
- All API endpoints with request/response schemas
- Interactive "Try it out" functionality
- Model definitions and examples
- Authentication requirements (when configured)

## Project Structure

```
rfq-automation/
├── src/
│   ├── agents/           # Agent implementations
│   │   ├── base/         # Base agent class
│   │   ├── intake/       # Intake agent
│   │   ├── missing-info/ # Missing info agent
│   │   ├── duplicate/    # Duplicate detection agent
│   │   ├── prioritization/ # Prioritization agent
│   │   ├── mto/          # MTO agent
│   │   └── auto-quote/   # Auto-quote agent
│   ├── api/              # REST API
│   │   ├── routes/       # API routes
│   │   └── server.ts     # Fastify server
│   ├── core/             # Core services
│   │   ├── email/        # Email management
│   │   ├── events/       # Event sourcing
│   │   ├── execution/    # Execution management
│   │   ├── queue/        # Queue service
│   │   ├── state/        # State/snapshot management
│   │   └── storage/      # MinIO storage
│   ├── config/           # Configuration
│   ├── db/               # Database client
│   ├── prompts/          # Prompt templates
│   │   └── templates/    # Handlebars templates
│   ├── shared/           # Shared types and utilities
│   ├── workers/          # Queue workers
│   └── main.ts           # Application entry point
├── prisma/
│   └── schema.prisma     # Database schema
├── docker-compose.yml
└── package.json
```

## API Endpoints

### Emails

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/emails` | Upload email with attachments (multipart) |
| `GET` | `/emails` | List emails with pagination |
| `GET` | `/emails/:id` | Get email details with attachments |
| `GET` | `/emails/:id/attachments/:aid` | Download attachment |

### Executions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/executions` | Create new execution for an email |
| `GET` | `/executions/:id` | Get execution status and details |
| `GET` | `/executions/:id/history` | Get full audit history |
| `POST` | `/executions/:id/resume` | Resume after human intervention |
| `POST` | `/executions/:id/replay` | Replay from specific agent |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Basic health check |
| `GET` | `/health/ready` | Readiness check (DB + Redis + MinIO) |

## Environment Variables

```env
# Application
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://rfq_user:rfq_password@localhost:5432/rfq_automation

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minio_admin
MINIO_SECRET_KEY=minio_password
MINIO_BUCKET=rfq-attachments

# Anthropic API
ANTHROPIC_API_KEY=your_api_key_here

# Agent Configuration
AGENT_MAX_TURNS=15
AGENT_CONCURRENCY=5
```

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev:api` | Start API server in development mode |
| `pnpm dev:workers` | Start workers in development mode |
| `pnpm build` | Build TypeScript to JavaScript |
| `pnpm start` | Start API server (production) |
| `pnpm start:workers` | Start workers (production) |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:migrate:dev` | Run database migrations (dev) |
| `pnpm db:migrate:deploy` | Run database migrations (prod) |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm test` | Run tests |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run TypeScript type checking |

## Usage Example

### 1. Upload an Email

```bash
curl -X POST http://localhost:3000/emails \
  -F 'email={"subject":"RFQ for Curtain Wall","body":"Please provide a quote...","senderEmail":"customer@example.com","receivedAt":"2024-01-15T10:00:00Z"}' \
  -F 'attachments=@specs.pdf' \
  -F 'attachments=@drawings.dwg'
```

### 2. Create an Execution

```bash
curl -X POST http://localhost:3000/executions \
  -H "Content-Type: application/json" \
  -d '{"emailId": "<email-id-from-step-1>"}'
```

### 3. Check Execution Status

```bash
curl http://localhost:3000/executions/<execution-id>
```

### 4. Resume After Human Intervention

```bash
curl -X POST http://localhost:3000/executions/<execution-id>/resume \
  -H "Content-Type: application/json" \
  -d '{
    "updatedState": {
      "parsedData": {
        "customerName": "Acme Corp"
      }
    }
  }'
```

## Infrastructure Services

The `docker-compose.yml` provides:

- **PostgreSQL** (port 5432): Primary database
- **Redis** (port 6379): Queue backend and caching
- **MinIO** (ports 9000/9001): Object storage for attachments
  - API: http://localhost:9000
  - Console: http://localhost:9001 (admin: `minio_admin` / `minio_password`)

## Database Schema

Key models:

- **Email**: Stores uploaded emails and metadata
- **EmailAttachment**: Attachment metadata (stored in MinIO)
- **Execution**: Processing lifecycle for an email
- **AgentTask**: Individual agent executions
- **Event**: Immutable audit log (event sourcing)
- **RfqSnapshot**: State snapshots for resume/replay

## Human Intervention Flow

```
┌──────────┐     ┌──────────┐     ┌───────────────┐
│  Agent   │────▶│ Requires │────▶│   AWAITING    │
│Executing │     │  Human   │     │    HUMAN      │
└──────────┘     └──────────┘     └───────────────┘
                                         │
                                         │ Human provides input via API
                                         ▼
                                  ┌───────────────┐
                                  │ Resume API    │
                                  │ Called        │
                                  └───────────────┘
                                         │
                                         ▼
                                  ┌───────────────┐
                                  │ Agent Resumes │
                                  │ from checkpoint│
                                  └───────────────┘
```

## License

MIT
