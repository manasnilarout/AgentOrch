# RFQ Automation - AI Agent Layer Technical Specification

> **Version:** 1.0.0  
---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Overview](#2-project-overview)
3. [Technical Stack](#3-technical-stack)
4. [Architecture Overview](#4-architecture-overview)/
5. [Database Schema](#5-database-schema)
6. [Project Structure](#6-project-structure)
7. [Core Components](#7-core-components)
8. [Agent Implementations](#8-agent-implementations)
9. [Prompt Templating System](#9-prompt-templating-system)
10. [API Endpoints](#10-api-endpoints)
11. [Configuration](#11-configuration)
12. [Development Setup](#12-development-setup)
13. [Implementation Phases](#13-implementation-phases)
14. [Testing Strategy](#14-testing-strategy)
15. [Deployment](#15-deployment)

---

## 1. Executive Summary

This document specifies the technical architecture for the **AI Agent Layer** of the One Stop Shop Q&E Automation system. The system processes Request for Quote (RFQ) emails through a pipeline of 6 specialized AI agents, each performing atomic operations with full audit trails and human-in-the-loop capabilities.

### Key Objectives

- **Atomic Execution**: Each agent runs independently via message queues
- **Full Auditability**: Event sourcing captures every state change
- **Resume/Replay**: Checkpoint-based execution allows resumption from any point
- **Human-in-the-Loop**: Agents can pause for human intervention and resume after updates
- **Scalability**: Queue-based architecture supports horizontal scaling

---

## 2. Project Overview

### 2.1 Agent Pipeline

The AI Agent Layer consists of 6 agents that process RFQs sequentially:

| # | Agent | Timeline | Purpose |
|---|-------|----------|---------|
| 1 | **Intake Agent** | Q1 | Parse incoming RFQ emails and extract structured data |
| 2 | **Missing Info Agent** | Q1 | Identify missing information and generate clarification requests |
| 3 | **Duplicate RFQ Agent** | Q1 | Detect duplicate or similar RFQ requests |
| 4 | **Prioritization Agent** | Q1 | Classify complexity and assign priority |
| 5 | **MTO Agent** | Q2 | Generate Material Take-Off drafts |
| 6 | **Auto-Quote Agent** | Q2 | Generate quotes for low/medium complexity requests |

### 2.2 Input Format

Each execution receives:
- **Email Body**: Plain text content of the RFQ email
- **Attachment Directory**: Path to blob storage containing email attachments (PDFs, drawings, specifications)
- **Sender Email**: Email address of the requester
- **Received Timestamp**: When the email was received

### 2.3 Core Requirements

1. **Execution Tracking**: Every process has a unique execution ID with complete progress persisted in PostgreSQL
2. **Full Audit Trail**: All state changes are recorded as immutable events
3. **Replay/Resume/Re-execute**: System can resume from any checkpoint or replay entire executions
4. **Human Intervention**: Agents can request human input and resume after updates

---

## 3. Technical Stack

| Component | Technology | Version | Purpose |
|-----------|------------|---------|---------|
| **Runtime** | Node.js | 18+ | JavaScript runtime |
| **Language** | TypeScript | 5.x | Type-safe development |
| **Agent SDK** | `@anthropic-ai/claude-agent-sdk` | Latest | Claude Agent execution |
| **Message Queue** | BullMQ | 5.x | Redis-backed job queue |
| **Database** | PostgreSQL | 16 | Primary data store |
| **ORM** | Prisma | 5.x | Type-safe database access |
| **Cache/Queue Backend** | Redis | 7.x | Queue storage and caching |
| **Prompt Templates** | Handlebars | 4.x | Template engine |
| **Validation** | Zod | 3.x | Runtime type validation |
| **API Framework** | Fastify | 4.x | REST API server |
| **Logging** | Pino | 8.x | Structured logging |

### 3.1 Key Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^latest",
    "@prisma/client": "^5.0.0",
    "bullmq": "^5.0.0",
    "fastify": "^4.0.0",
    "handlebars": "^4.7.0",
    "zod": "^3.22.0",
    "ioredis": "^5.0.0",
    "pino": "^8.0.0"
  },
  "devDependencies": {
    "prisma": "^5.0.0",
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "vitest": "^1.0.0"
  }
}
```

---

## 4. Architecture Overview

### 4.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              EXECUTION LAYER                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐       │
│  │   Intake    │    │ Missing Info│    │  Duplicate  │    │Prioritization│ ...  │
│  │   Worker    │    │   Worker    │    │   Worker    │    │   Worker    │       │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘       │
│         │                  │                  │                  │              │
│         └──────────────────┴──────────────────┴──────────────────┘              │
│                                      │                                          │
│                                      ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                      MESSAGE BROKER (BullMQ/Redis)                       │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │   │
│  │  │ intake  │ │ missing │ │duplicate│ │priority │ │   mto   │ │  quote  │ │   │
│  │  │ .queue  │ │ .queue  │ │ .queue  │ │ .queue  │ │ .queue  │ │ .queue  │ │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CORE SERVICES                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │  Execution     │  │  State         │  │  Event         │  │  Agent        │  │
│  │  Manager       │  │  Manager       │  │  Store         │  │  Registry     │  │
│  │                │  │                │  │  (Audit Log)   │  │               │  │
│  └────────────────┘  └────────────────┘  └────────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              PERSISTENCE LAYER                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────┐         ┌─────────────────────────────┐        │
│  │        PostgreSQL           │         │          Redis              │        │
│  │  • executions               │         │  • Queue state              │        │
│  │  • agent_tasks              │         │  • Distributed locks        │        │
│  │  • events (audit log)       │         │  • Caching                  │        │
│  │  • rfq_snapshots            │         │                             │        │
│  └─────────────────────────────┘         └─────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Execution Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Start   │────▶│  Intake  │────▶│ Missing  │────▶│Duplicate │
│Execution │     │  Agent   │     │Info Agent│     │  Agent   │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                                                        │
                      ┌─────────────────────────────────┘
                      ▼
               ┌──────────┐     ┌──────────┐     ┌──────────┐
               │Priority  │────▶│   MTO    │────▶│  Quote   │
               │  Agent   │     │  Agent   │     │  Agent   │
               └──────────┘     └──────────┘     └──────────┘
                                                      │
                                                      ▼
                                               ┌──────────┐
                                               │ Complete │
                                               └──────────┘
```

### 4.3 Human Intervention Flow

```
┌──────────┐     ┌──────────┐     ┌───────────────┐
│  Agent   │────▶│ Requires │────▶│   AWAITING    │
│Executing │     │  Human   │     │    HUMAN      │
└──────────┘     └──────────┘     └───────────────┘
                                         │
                                         │ Human provides input
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

### 4.4 Design Patterns

1. **Event Sourcing**: All state changes are captured as immutable events
2. **Checkpoint-Based Resume**: Agents create snapshots after successful processing
3. **Agent as Pure Function**: `Agent(State, Input) → (NewState, Events, NextAction)`
4. **Command Query Responsibility Segregation (CQRS)**: Separate read and write models

---

## 5. Database Schema

### 5.1 Prisma Schema

Create file: `prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================
// ENUMS
// ============================================

enum ExecutionStatus {
  PENDING
  PROCESSING
  AWAITING_HUMAN
  COMPLETED
  FAILED
  CANCELLED
}

enum AgentTaskStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
  AWAITING_HUMAN
  SKIPPED
}

enum SnapshotType {
  INPUT
  OUTPUT
  HUMAN_UPDATE
}

// ============================================
// MODELS
// ============================================

/// Main execution record - tracks the entire RFQ processing lifecycle
model Execution {
  id            String           @id @default(uuid())
  externalRef   String?          @map("external_ref") // e.g., email message ID
  status        ExecutionStatus  @default(PENDING)
  currentAgent  String?          @map("current_agent")
  metadata      Json             @default("{}")
  
  // Input data
  emailBody     String           @map("email_body") @db.Text
  attachmentDir String           @map("attachment_dir")
  senderEmail   String           @map("sender_email")
  receivedAt    DateTime         @map("received_at")
  
  // Timestamps
  createdAt     DateTime         @default(now()) @map("created_at")
  updatedAt     DateTime         @updatedAt @map("updated_at")
  completedAt   DateTime?        @map("completed_at")
  
  // Relations
  agentTasks    AgentTask[]
  events        Event[]
  snapshots     RfqSnapshot[]

  @@index([status])
  @@index([externalRef])
  @@index([createdAt])
  @@index([senderEmail])
  @@map("executions")
}

/// Individual agent task execution within an overall execution
model AgentTask {
  id               String          @id @default(uuid())
  executionId      String          @map("execution_id")
  agentName        String          @map("agent_name")
  attemptNumber    Int             @default(1) @map("attempt_number")
  status           AgentTaskStatus @default(PENDING)
  
  // Snapshot references
  inputSnapshotId  String?         @map("input_snapshot_id")
  outputSnapshotId String?         @map("output_snapshot_id")
  
  // Execution details
  errorMessage     String?         @map("error_message") @db.Text
  durationMs       Int?            @map("duration_ms")
  tokenUsage       Json?           @map("token_usage")
  costUsd          Decimal?        @map("cost_usd") @db.Decimal(10, 6)
  
  // Timestamps
  startedAt        DateTime?       @map("started_at")
  completedAt      DateTime?       @map("completed_at")
  createdAt        DateTime        @default(now()) @map("created_at")
  
  // Relations
  execution        Execution       @relation(fields: [executionId], references: [id], onDelete: Cascade)
  events           Event[]
  inputSnapshot    RfqSnapshot?    @relation("InputSnapshot", fields: [inputSnapshotId], references: [id])
  outputSnapshot   RfqSnapshot?    @relation("OutputSnapshot", fields: [outputSnapshotId], references: [id])

  @@index([executionId])
  @@index([agentName])
  @@index([status])
  @@index([createdAt])
  @@map("agent_tasks")
}

/// Immutable event log for audit trail (Event Sourcing)
model Event {
  id           String     @id @default(uuid())
  executionId  String     @map("execution_id")
  agentTaskId  String?    @map("agent_task_id")
  
  eventType    String     @map("event_type")
  eventData    Json       @map("event_data")
  
  createdAt    DateTime   @default(now()) @map("created_at")
  
  // Relations
  execution    Execution  @relation(fields: [executionId], references: [id], onDelete: Cascade)
  agentTask    AgentTask? @relation(fields: [agentTaskId], references: [id], onDelete: SetNull)

  @@index([executionId])
  @@index([agentTaskId])
  @@index([eventType])
  @@index([createdAt])
  @@map("events")
}

/// RFQ state snapshots for resume/replay functionality
model RfqSnapshot {
  id           String       @id @default(uuid())
  executionId  String       @map("execution_id")
  agentName    String       @map("agent_name")
  snapshotType SnapshotType @map("snapshot_type")
  data         Json
  
  createdAt    DateTime     @default(now()) @map("created_at")
  
  // Relations
  execution    Execution    @relation(fields: [executionId], references: [id], onDelete: Cascade)
  
  // Reverse relations for AgentTask
  inputForTasks  AgentTask[] @relation("InputSnapshot")
  outputForTasks AgentTask[] @relation("OutputSnapshot")

  @@index([executionId])
  @@index([agentName])
  @@index([snapshotType])
  @@index([createdAt])
  @@map("rfq_snapshots")
}
```

### 5.2 Event Types

The following event types should be recorded in the `events` table:

| Event Type | Description |
|------------|-------------|
| `EXECUTION_CREATED` | New execution started |
| `EXECUTION_COMPLETED` | Execution finished successfully |
| `EXECUTION_FAILED` | Execution failed with error |
| `EXECUTION_CANCELLED` | Execution manually cancelled |
| `AGENT_STARTED` | Agent began processing |
| `AGENT_COMPLETED` | Agent finished successfully |
| `AGENT_FAILED` | Agent encountered error |
| `HUMAN_INTERVENTION_REQUIRED` | Agent paused for human input |
| `HUMAN_INPUT_RECEIVED` | Human provided input |
| `EXECUTION_RESUMED` | Execution resumed after human input |
| `STATE_SNAPSHOT_CREATED` | State snapshot saved |
| `TOOL_INVOKED` | Agent invoked a tool |
| `TOOL_COMPLETED` | Tool execution completed |
| `TOOL_FAILED` | Tool execution failed |

---

## 6. Project Structure

```
rfq-automation/
├── src/
│   ├── agents/                      # Agent implementations
│   │   ├── base/
│   │   │   ├── base-agent.ts        # Abstract base class using SDK
│   │   │   ├── agent-context.ts     # Execution context types
│   │   │   ├── agent-result.ts      # Result types
│   │   │   └── index.ts
│   │   ├── intake/
│   │   │   ├── intake.agent.ts      # Intake agent implementation
│   │   │   ├── intake.tools.ts      # MCP tools for intake
│   │   │   ├── intake.schema.ts     # Zod output schema
│   │   │   └── index.ts
│   │   ├── missing-info/
│   │   │   ├── missing-info.agent.ts
│   │   │   ├── missing-info.tools.ts
│   │   │   ├── missing-info.schema.ts
│   │   │   └── index.ts
│   │   ├── duplicate/
│   │   │   ├── duplicate.agent.ts
│   │   │   ├── duplicate.tools.ts
│   │   │   ├── duplicate.schema.ts
│   │   │   └── index.ts
│   │   ├── prioritization/
│   │   │   ├── prioritization.agent.ts
│   │   │   ├── prioritization.tools.ts
│   │   │   ├── prioritization.schema.ts
│   │   │   └── index.ts
│   │   ├── mto/
│   │   │   ├── mto.agent.ts
│   │   │   ├── mto.tools.ts
│   │   │   ├── mto.schema.ts
│   │   │   └── index.ts
│   │   ├── auto-quote/
│   │   │   ├── auto-quote.agent.ts
│   │   │   ├── auto-quote.tools.ts
│   │   │   ├── auto-quote.schema.ts
│   │   │   └── index.ts
│   │   └── index.ts                 # Agent registry export
│   │
│   ├── prompts/                     # Centralized prompt templates
│   │   ├── engine.ts                # Handlebars setup & helpers
│   │   ├── types.ts                 # Template context types
│   │   ├── templates/
│   │   │   ├── intake.system.hbs
│   │   │   ├── intake.user.hbs
│   │   │   ├── missing-info.system.hbs
│   │   │   ├── missing-info.user.hbs
│   │   │   ├── duplicate.system.hbs
│   │   │   ├── duplicate.user.hbs
│   │   │   ├── prioritization.system.hbs
│   │   │   ├── prioritization.user.hbs
│   │   │   ├── mto.system.hbs
│   │   │   ├── mto.user.hbs
│   │   │   ├── auto-quote.system.hbs
│   │   │   └── auto-quote.user.hbs
│   │   └── index.ts                 # Compiled template exports
│   │
│   ├── core/                        # Core services
│   │   ├── execution/
│   │   │   ├── execution.service.ts # Execution management
│   │   │   ├── execution.repository.ts
│   │   │   └── index.ts
│   │   ├── state/
│   │   │   ├── state.service.ts     # State/snapshot management
│   │   │   ├── snapshot.repository.ts
│   │   │   └── index.ts
│   │   ├── events/
│   │   │   ├── event.service.ts     # Event sourcing
│   │   │   ├── event.repository.ts
│   │   │   ├── event.types.ts
│   │   │   └── index.ts
│   │   └── queue/
│   │       ├── queue.service.ts     # Queue management
│   │       ├── worker.factory.ts    # Worker creation
│   │       └── index.ts
│   │
│   ├── workers/                     # Queue workers
│   │   ├── agent.worker.ts          # Generic agent worker
│   │   ├── worker.bootstrap.ts      # Worker initialization
│   │   └── index.ts
│   │
│   ├── api/                         # REST API
│   │   ├── routes/
│   │   │   ├── executions.route.ts  # Execution CRUD
│   │   │   ├── resume.route.ts      # Resume/replay endpoints
│   │   │   ├── health.route.ts      # Health checks
│   │   │   └── index.ts
│   │   ├── middleware/
│   │   │   ├── error-handler.ts
│   │   │   ├── request-logger.ts
│   │   │   └── index.ts
│   │   ├── schemas/                 # API request/response schemas
│   │   │   ├── execution.schema.ts
│   │   │   └── index.ts
│   │   └── server.ts                # Fastify server setup
│   │
│   ├── db/
│   │   ├── client.ts                # Prisma client singleton
│   │   └── index.ts
│   │
│   ├── shared/
│   │   ├── types/
│   │   │   ├── rfq.types.ts         # RFQ domain types
│   │   │   ├── agent.types.ts       # Agent-related types
│   │   │   └── index.ts
│   │   ├── schemas/
│   │   │   └── rfq.schema.ts        # Zod schemas for RFQ
│   │   ├── utils/
│   │   │   ├── logger.ts            # Pino logger setup
│   │   │   ├── errors.ts            # Custom error classes
│   │   │   └── index.ts
│   │   └── constants.ts
│   │
│   ├── config/
│   │   ├── index.ts                 # Configuration loader
│   │   ├── agents.config.ts         # Agent pipeline configuration
│   │   ├── queue.config.ts          # Queue configuration
│   │   └── database.config.ts       # Database configuration
│   │
│   └── main.ts                      # Application entry point
│
├── prisma/
│   ├── schema.prisma                # Database schema
│   ├── migrations/                  # Auto-generated migrations
│   └── seed.ts                      # Database seeding script
│
├── tests/
│   ├── unit/
│   │   ├── agents/
│   │   └── core/
│   ├── integration/
│   │   ├── agents/
│   │   └── api/
│   └── fixtures/
│       ├── rfq-samples/             # Sample RFQ data
│       └── attachments/             # Test attachments
│
├── scripts/
│   ├── start-workers.ts             # Start all workers
│   └── replay-execution.ts          # CLI for replaying executions
│
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── .env.example
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## 7. Core Components

### 7.1 Types and Interfaces

Create file: `src/shared/types/rfq.types.ts`

```typescript
/**
 * Input data for RFQ processing
 */
export interface RfqInput {
  emailBody: string;
  attachmentDir: string;
  senderEmail: string;
  receivedAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Accumulated state as RFQ progresses through agents
 */
export interface RfqState {
  // Intake Agent output
  parsedData?: {
    customerName?: string;
    projectName?: string;
    projectReference?: string;
    requestedProducts: ProductRequest[];
    timeline?: string;
    specialRequirements?: string[];
  };
  
  // Missing Info Agent output
  missingFields?: string[];
  clarificationRequests?: ClarificationRequest[];
  
  // Duplicate Agent output
  duplicateCheckResult?: {
    isDuplicate: boolean;
    similarRfqIds?: string[];
    similarityScore?: number;
  };
  
  // Prioritization Agent output
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  complexity?: 'SIMPLE' | 'MODERATE' | 'COMPLEX';
  estimatedHours?: number;
  
  // MTO Agent output
  mtoData?: MaterialTakeOff;
  
  // Auto-Quote Agent output
  quote?: QuoteResult;
}

export interface ProductRequest {
  name: string;
  quantity?: number;
  unit?: string;
  specifications?: Record<string, unknown>;
  drawings?: string[];
}

export interface ClarificationRequest {
  field: string;
  question: string;
  context?: string;
}

export interface MaterialTakeOff {
  lineItems: MtoLineItem[];
  totalEstimatedCost?: number;
  notes?: string[];
}

export interface MtoLineItem {
  productCode: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  totalPrice?: number;
}

export interface QuoteResult {
  quoteNumber: string;
  validUntil: Date;
  lineItems: QuoteLineItem[];
  subtotal: number;
  tax?: number;
  total: number;
  terms?: string;
  notes?: string[];
}

export interface QuoteLineItem {
  productCode: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}
```

Create file: `src/shared/types/agent.types.ts`

```typescript
import { RfqState, RfqInput } from './rfq.types';

/**
 * Agent names in the pipeline
 */
export type AgentName =
  | 'intake'
  | 'missing-info'
  | 'duplicate'
  | 'prioritization'
  | 'mto'
  | 'auto-quote';

/**
 * Ordered list of agents in the pipeline
 */
export const AGENT_PIPELINE: AgentName[] = [
  'intake',
  'missing-info',
  'duplicate',
  'prioritization',
  'mto',
  'auto-quote',
];

/**
 * Context passed to each agent during execution
 */
export interface AgentContext {
  executionId: string;
  input: RfqInput;
  currentState: RfqState;
  attachmentList: string[];
  attempt: number;
  workingDir: string;
}

/**
 * Possible next actions after agent execution
 */
export type NextAction =
  | { type: 'CONTINUE'; nextAgent: AgentName }
  | { type: 'AWAIT_HUMAN'; reason: string; requiredFields?: string[] }
  | { type: 'COMPLETE' }
  | { type: 'FAIL'; error: string }
  | { type: 'SKIP'; reason: string; nextAgent: AgentName };

/**
 * Domain event for audit trail
 */
export interface DomainEvent {
  id: string;
  eventType: string;
  eventData: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Result returned by agent execution
 */
export interface AgentResult<TOutput = unknown> {
  success: boolean;
  outputState: Partial<RfqState>;
  events: DomainEvent[];
  nextAction: NextAction;
  agentOutput?: TOutput;
  metadata?: {
    durationMs?: number;
    tokenUsage?: TokenUsage;
    costUsd?: number;
  };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}
```

### 7.2 Base Agent Implementation

Create file: `src/agents/base/base-agent.ts`

```typescript
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, SDKResultMessage, HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { AgentContext, AgentResult, NextAction, DomainEvent, AgentName, AGENT_PIPELINE } from '../../shared/types/agent.types';
import { RfqState } from '../../shared/types/rfq.types';
import { logger } from '../../shared/utils/logger';

export abstract class BaseAgent<TOutput = unknown> {
  protected agentName: AgentName;
  protected abortController: AbortController;

  constructor(agentName: AgentName) {
    this.agentName = agentName;
    this.abortController = new AbortController();
  }

  /**
   * Main execution method - orchestrates the agent workflow
   */
  async execute(context: AgentContext): Promise<AgentResult<TOutput>> {
    const events: DomainEvent[] = [];
    const startTime = Date.now();

    logger.info({ executionId: context.executionId, agent: this.agentName }, 'Agent execution started');

    try {
      events.push(this.createEvent('AGENT_STARTED', { agent: this.agentName }));

      // Build prompts using templating engine
      const systemPrompt = this.buildSystemPrompt(context);
      const userPrompt = this.buildUserPrompt(context);

      // Create MCP server with agent-specific tools
      const mcpServer = this.createMcpServer(context);

      // Execute using Claude Agent SDK
      const result = await this.runAgentLoop({
        systemPrompt,
        userPrompt,
        mcpServer,
        context,
      });

      // Parse and validate output
      const parsedOutput = await this.parseOutput(result, context);

      // Determine next action
      const nextAction = this.determineNextAction(parsedOutput, context);

      const durationMs = Date.now() - startTime;

      events.push(
        this.createEvent('AGENT_COMPLETED', {
          agent: this.agentName,
          durationMs,
          tokenUsage: result.usage,
          costUsd: result.totalCostUsd,
        })
      );

      logger.info(
        { executionId: context.executionId, agent: this.agentName, durationMs },
        'Agent execution completed'
      );

      return {
        success: true,
        outputState: parsedOutput.state,
        events,
        nextAction,
        agentOutput: parsedOutput.output as TOutput,
        metadata: {
          durationMs,
          tokenUsage: result.usage,
          costUsd: result.totalCostUsd,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      events.push(
        this.createEvent('AGENT_FAILED', {
          agent: this.agentName,
          error: errorMessage,
          durationMs,
        })
      );

      logger.error(
        { executionId: context.executionId, agent: this.agentName, error: errorMessage },
        'Agent execution failed'
      );

      return {
        success: false,
        outputState: {},
        events,
        nextAction: { type: 'FAIL', error: errorMessage },
        metadata: { durationMs },
      };
    }
  }

  /**
   * Execute the agent loop using Claude Agent SDK
   */
  private async runAgentLoop(params: {
    systemPrompt: string;
    userPrompt: string;
    mcpServer: ReturnType<typeof createSdkMcpServer>;
    context: AgentContext;
  }): Promise<{ result: string; usage: any; totalCostUsd: number }> {
    const messages: SDKMessage[] = [];
    let finalResult: SDKResultMessage | null = null;

    const hooks = this.createHooks(params.context);

    const queryResult = query({
      prompt: params.userPrompt,
      options: {
        systemPrompt: params.systemPrompt,
        abortController: this.abortController,
        mcpServers: {
          [this.agentName]: {
            type: 'sdk',
            name: this.agentName,
            instance: params.mcpServer.instance,
          },
        },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 15,
        hooks,
        cwd: params.context.workingDir,
      },
    });

    for await (const message of queryResult) {
      messages.push(message);
      if (message.type === 'result') {
        finalResult = message;
      }
    }

    if (!finalResult || finalResult.subtype !== 'success') {
      const errorMsg =
        finalResult?.subtype === 'error_during_execution'
          ? (finalResult as any).errors?.join(', ')
          : 'Agent execution failed';
      throw new Error(errorMsg);
    }

    return {
      result: finalResult.result,
      usage: finalResult.usage,
      totalCostUsd: finalResult.total_cost_usd,
    };
  }

  /**
   * Create hooks for auditing tool usage
   */
  private createHooks(context: AgentContext): Record<string, { hooks: HookCallback[] }[]> {
    const preToolUseHook: HookCallback = async (input) => {
      if (input.hook_event_name === 'PreToolUse') {
        logger.debug(
          { executionId: context.executionId, tool: input.tool_name },
          'Tool invoked'
        );
      }
      return { continue: true };
    };

    const postToolUseHook: HookCallback = async (input) => {
      if (input.hook_event_name === 'PostToolUse') {
        logger.debug(
          { executionId: context.executionId, tool: input.tool_name },
          'Tool completed'
        );
      }
      return { continue: true };
    };

    return {
      PreToolUse: [{ hooks: [preToolUseHook] }],
      PostToolUse: [{ hooks: [postToolUseHook] }],
    };
  }

  /**
   * Get the next agent in the pipeline
   */
  protected getNextAgent(): AgentName | null {
    const currentIndex = AGENT_PIPELINE.indexOf(this.agentName);
    if (currentIndex === -1 || currentIndex === AGENT_PIPELINE.length - 1) {
      return null;
    }
    return AGENT_PIPELINE[currentIndex + 1];
  }

  /**
   * Helper: Continue to next agent in pipeline
   */
  protected continueToNextAgent(): NextAction {
    const nextAgent = this.getNextAgent();
    if (nextAgent) {
      return { type: 'CONTINUE', nextAgent };
    }
    return { type: 'COMPLETE' };
  }

  /**
   * Helper: Require human intervention
   */
  protected requireHumanIntervention(reason: string, requiredFields?: string[]): NextAction {
    return { type: 'AWAIT_HUMAN', reason, requiredFields };
  }

  /**
   * Helper: Skip to specific agent
   */
  protected skipToAgent(reason: string, nextAgent: AgentName): NextAction {
    return { type: 'SKIP', reason, nextAgent };
  }

  /**
   * Create a domain event
   */
  protected createEvent(type: string, data: Record<string, unknown>): DomainEvent {
    return {
      id: crypto.randomUUID(),
      eventType: type,
      eventData: data,
      createdAt: new Date(),
    };
  }

  /**
   * Abort the agent execution
   */
  abort(): void {
    this.abortController.abort();
  }

  /**
   * Extract JSON from agent response (handles markdown code blocks)
   */
  protected extractJsonFromResponse(response: string): unknown {
    // Try to extract JSON from markdown code block
    const jsonMatch = response.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }

    // Try parsing the whole response as JSON
    try {
      return JSON.parse(response);
    } catch {
      throw new Error('Could not extract structured output from agent response');
    }
  }

  // ============================================
  // Abstract methods - each agent implements these
  // ============================================

  /**
   * Build the system prompt for this agent
   */
  protected abstract buildSystemPrompt(context: AgentContext): string;

  /**
   * Build the user prompt for this agent
   */
  protected abstract buildUserPrompt(context: AgentContext): string;

  /**
   * Create the MCP server with agent-specific tools
   */
  protected abstract createMcpServer(
    context: AgentContext
  ): ReturnType<typeof createSdkMcpServer>;

  /**
   * Parse and validate the agent's output
   */
  protected abstract parseOutput(
    result: { result: string },
    context: AgentContext
  ): Promise<{ state: Partial<RfqState>; output: unknown }>;

  /**
   * Determine the next action based on output
   */
  protected abstract determineNextAction(
    parsedOutput: { state: Partial<RfqState>; output: unknown },
    context: AgentContext
  ): NextAction;
}
```

### 7.3 Queue Service

Create file: `src/core/queue/queue.service.ts`

```typescript
import { Queue, QueueEvents } from 'bullmq';
import { AgentName } from '../../shared/types/agent.types';
import { redisConnection } from '../../config/queue.config';
import { logger } from '../../shared/utils/logger';

export interface JobData {
  executionId: string;
}

export class QueueService {
  private queues: Map<AgentName, Queue<JobData>> = new Map();
  private queueEvents: Map<AgentName, QueueEvents> = new Map();

  constructor() {
    this.initializeQueues();
  }

  private initializeQueues(): void {
    const agentNames: AgentName[] = [
      'intake',
      'missing-info',
      'duplicate',
      'prioritization',
      'mto',
      'auto-quote',
    ];

    for (const agentName of agentNames) {
      const queue = new Queue<JobData>(agentName, {
        connection: redisConnection,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: 100,
          removeOnFail: 1000,
        },
      });

      const events = new QueueEvents(agentName, { connection: redisConnection });

      this.queues.set(agentName, queue);
      this.queueEvents.set(agentName, events);

      logger.info({ agent: agentName }, 'Queue initialized');
    }
  }

  /**
   * Add a job to the specified agent's queue
   */
  async enqueue(agentName: AgentName, data: JobData): Promise<string> {
    const queue = this.queues.get(agentName);
    if (!queue) {
      throw new Error(`Queue not found for agent: ${agentName}`);
    }

    const job = await queue.add(agentName, data, {
      jobId: `${data.executionId}-${agentName}-${Date.now()}`,
    });

    logger.info(
      { executionId: data.executionId, agent: agentName, jobId: job.id },
      'Job enqueued'
    );

    return job.id!;
  }

  /**
   * Get a queue by agent name
   */
  getQueue(agentName: AgentName): Queue<JobData> | undefined {
    return this.queues.get(agentName);
  }

  /**
   * Close all queues gracefully
   */
  async close(): Promise<void> {
    for (const [name, queue] of this.queues) {
      await queue.close();
      logger.info({ agent: name }, 'Queue closed');
    }

    for (const [name, events] of this.queueEvents) {
      await events.close();
    }
  }
}

// Singleton instance
export const queueService = new QueueService();
```

### 7.4 Event Service

Create file: `src/core/events/event.service.ts`

```typescript
import { prisma } from '../../db/client';
import { DomainEvent } from '../../shared/types/agent.types';
import { logger } from '../../shared/utils/logger';

export class EventService {
  /**
   * Save a single event
   */
  async save(
    event: DomainEvent & { executionId: string; agentTaskId?: string }
  ): Promise<string> {
    const created = await prisma.event.create({
      data: {
        id: event.id,
        executionId: event.executionId,
        agentTaskId: event.agentTaskId,
        eventType: event.eventType,
        eventData: event.eventData,
        createdAt: event.createdAt,
      },
    });

    logger.debug(
      { eventId: created.id, eventType: event.eventType },
      'Event saved'
    );

    return created.id;
  }

  /**
   * Save multiple events in a transaction
   */
  async saveMany(
    events: Array<DomainEvent & { executionId: string; agentTaskId?: string }>
  ): Promise<number> {
    if (events.length === 0) return 0;

    const result = await prisma.event.createMany({
      data: events.map((event) => ({
        id: event.id,
        executionId: event.executionId,
        agentTaskId: event.agentTaskId,
        eventType: event.eventType,
        eventData: event.eventData,
        createdAt: event.createdAt,
      })),
    });

    logger.debug({ count: result.count }, 'Events saved');

    return result.count;
  }

  /**
   * Get all events for an execution
   */
  async getByExecutionId(executionId: string) {
    return prisma.event.findMany({
      where: { executionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get events by type
   */
  async getByType(executionId: string, eventType: string) {
    return prisma.event.findMany({
      where: { executionId, eventType },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get events for a specific agent task
   */
  async getByAgentTaskId(agentTaskId: string) {
    return prisma.event.findMany({
      where: { agentTaskId },
      orderBy: { createdAt: 'asc' },
    });
  }
}

export const eventService = new EventService();
```

### 7.5 Execution Service

Create file: `src/core/execution/execution.service.ts`

```typescript
import { ExecutionStatus, AgentTaskStatus } from '@prisma/client';
import { prisma } from '../../db/client';
import { RfqInput, RfqState } from '../../shared/types/rfq.types';
import { AgentName } from '../../shared/types/agent.types';
import { queueService } from '../queue/queue.service';
import { eventService } from '../events/event.service';
import { logger } from '../../shared/utils/logger';

export interface CreateExecutionInput {
  emailBody: string;
  attachmentDir: string;
  senderEmail: string;
  receivedAt: Date;
  externalRef?: string;
  metadata?: Record<string, unknown>;
}

export class ExecutionService {
  /**
   * Create a new execution and enqueue the first agent
   */
  async create(input: CreateExecutionInput): Promise<string> {
    const execution = await prisma.execution.create({
      data: {
        emailBody: input.emailBody,
        attachmentDir: input.attachmentDir,
        senderEmail: input.senderEmail,
        receivedAt: input.receivedAt,
        externalRef: input.externalRef,
        metadata: input.metadata || {},
        status: 'PENDING',
        currentAgent: 'intake',
      },
    });

    // Record creation event
    await eventService.save({
      id: crypto.randomUUID(),
      executionId: execution.id,
      eventType: 'EXECUTION_CREATED',
      eventData: { input },
      createdAt: new Date(),
    });

    // Enqueue the first agent
    await queueService.enqueue('intake', { executionId: execution.id });

    logger.info({ executionId: execution.id }, 'Execution created');

    return execution.id;
  }

  /**
   * Get execution by ID with related data
   */
  async getById(executionId: string) {
    return prisma.execution.findUnique({
      where: { id: executionId },
      include: {
        agentTasks: {
          orderBy: { createdAt: 'asc' },
        },
        snapshots: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  /**
   * Get full execution history including all events
   */
  async getHistory(executionId: string) {
    const [execution, tasks, events, snapshots] = await Promise.all([
      prisma.execution.findUnique({ where: { id: executionId } }),
      prisma.agentTask.findMany({
        where: { executionId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.event.findMany({
        where: { executionId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.rfqSnapshot.findMany({
        where: { executionId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return { execution, tasks, events, snapshots };
  }

  /**
   * Update execution status
   */
  async updateStatus(executionId: string, status: ExecutionStatus, metadata?: Record<string, unknown>) {
    const updateData: any = { status };

    if (status === 'COMPLETED') {
      updateData.completedAt = new Date();
    }

    if (metadata) {
      const current = await prisma.execution.findUnique({
        where: { id: executionId },
        select: { metadata: true },
      });
      updateData.metadata = { ...(current?.metadata as object || {}), ...metadata };
    }

    return prisma.execution.update({
      where: { id: executionId },
      data: updateData,
    });
  }

  /**
   * Resume execution after human intervention
   */
  async resume(
    executionId: string,
    options: {
      updatedState?: Partial<RfqState>;
      resumeFromAgent?: AgentName;
    }
  ): Promise<void> {
    const execution = await prisma.execution.findUnique({
      where: { id: executionId },
    });

    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (execution.status !== 'AWAITING_HUMAN') {
      throw new Error(`Execution is not awaiting human input: ${execution.status}`);
    }

    // Apply human-provided state updates
    if (options.updatedState) {
      const latestSnapshot = await prisma.rfqSnapshot.findFirst({
        where: { executionId },
        orderBy: { createdAt: 'desc' },
      });

      const currentState = (latestSnapshot?.data as RfqState) || {};
      const mergedState = { ...currentState, ...options.updatedState };

      await prisma.rfqSnapshot.create({
        data: {
          executionId,
          agentName: 'human',
          snapshotType: 'HUMAN_UPDATE',
          data: mergedState,
        },
      });

      await eventService.save({
        id: crypto.randomUUID(),
        executionId,
        eventType: 'HUMAN_INPUT_RECEIVED',
        eventData: { updatedFields: Object.keys(options.updatedState) },
        createdAt: new Date(),
      });
    }

    // Resume from specified agent or current
    const targetAgent = options.resumeFromAgent || (execution.currentAgent as AgentName);

    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: 'PROCESSING',
        currentAgent: targetAgent,
      },
    });

    await eventService.save({
      id: crypto.randomUUID(),
      executionId,
      eventType: 'EXECUTION_RESUMED',
      eventData: { resumedFrom: targetAgent },
      createdAt: new Date(),
    });

    await queueService.enqueue(targetAgent, { executionId });

    logger.info({ executionId, agent: targetAgent }, 'Execution resumed');
  }

  /**
   * Replay execution from a specific agent
   */
  async replay(
    executionId: string,
    fromAgent: AgentName
  ): Promise<string> {
    const execution = await prisma.execution.findUnique({
      where: { id: executionId },
      include: {
        snapshots: {
          where: { agentName: fromAgent, snapshotType: 'INPUT' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    // Create a new execution as a fork
    const newExecution = await prisma.execution.create({
      data: {
        emailBody: execution.emailBody,
        attachmentDir: execution.attachmentDir,
        senderEmail: execution.senderEmail,
        receivedAt: execution.receivedAt,
        externalRef: execution.externalRef,
        metadata: {
          ...(execution.metadata as object || {}),
          replayedFrom: executionId,
          replayedFromAgent: fromAgent,
        },
        status: 'PENDING',
        currentAgent: fromAgent,
      },
    });

    // Copy the input snapshot if exists
    if (execution.snapshots.length > 0) {
      await prisma.rfqSnapshot.create({
        data: {
          executionId: newExecution.id,
          agentName: fromAgent,
          snapshotType: 'INPUT',
          data: execution.snapshots[0].data,
        },
      });
    }

    await eventService.save({
      id: crypto.randomUUID(),
      executionId: newExecution.id,
      eventType: 'EXECUTION_CREATED',
      eventData: { replayedFrom: executionId, fromAgent },
      createdAt: new Date(),
    });

    await queueService.enqueue(fromAgent, { executionId: newExecution.id });

    logger.info(
      { originalExecutionId: executionId, newExecutionId: newExecution.id, fromAgent },
      'Execution replayed'
    );

    return newExecution.id;
  }

  /**
   * Cancel an execution
   */
  async cancel(executionId: string): Promise<void> {
    await prisma.execution.update({
      where: { id: executionId },
      data: { status: 'CANCELLED' },
    });

    await eventService.save({
      id: crypto.randomUUID(),
      executionId,
      eventType: 'EXECUTION_CANCELLED',
      eventData: {},
      createdAt: new Date(),
    });

    logger.info({ executionId }, 'Execution cancelled');
  }
}

export const executionService = new ExecutionService();
```

### 7.6 Agent Worker

Create file: `src/workers/agent.worker.ts`

```typescript
import { Worker, Job } from 'bullmq';
import { prisma } from '../db/client';
import { BaseAgent, AgentName, AGENT_PIPELINE } from '../agents';
import { IntakeAgent } from '../agents/intake';
import { MissingInfoAgent } from '../agents/missing-info';
import { DuplicateAgent } from '../agents/duplicate';
import { PrioritizationAgent } from '../agents/prioritization';
import { MtoAgent } from '../agents/mto';
import { AutoQuoteAgent } from '../agents/auto-quote';
import { queueService, JobData } from '../core/queue/queue.service';
import { eventService } from '../core/events/event.service';
import { AgentContext, RfqState } from '../shared/types';
import { redisConnection } from '../config/queue.config';
import { logger } from '../shared/utils/logger';
import { readdir } from 'fs/promises';

// Agent factory registry
const agentFactory: Record<AgentName, () => BaseAgent> = {
  'intake': () => new IntakeAgent(),
  'missing-info': () => new MissingInfoAgent(),
  'duplicate': () => new DuplicateAgent(),
  'prioritization': () => new PrioritizationAgent(),
  'mto': () => new MtoAgent(),
  'auto-quote': () => new AutoQuoteAgent(),
};

/**
 * Create a worker for a specific agent
 */
export function createAgentWorker(agentName: AgentName): Worker {
  return new Worker<JobData>(
    agentName,
    async (job: Job<JobData>) => {
      const { executionId } = job.data;

      logger.info({ executionId, agent: agentName, jobId: job.id }, 'Processing job');

      // 1. Load execution from database
      const execution = await prisma.execution.findUniqueOrThrow({
        where: { id: executionId },
        include: {
          snapshots: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      // 2. Build current state from latest snapshot
      const latestSnapshot = execution.snapshots[0];
      const currentState: RfqState = latestSnapshot
        ? (latestSnapshot.data as RfqState)
        : {};

      // 3. Get attachment list
      const attachmentList = await readdir(execution.attachmentDir).catch(() => []);

      // 4. Build agent context
      const context: AgentContext = {
        executionId,
        input: {
          emailBody: execution.emailBody,
          attachmentDir: execution.attachmentDir,
          senderEmail: execution.senderEmail,
          receivedAt: execution.receivedAt,
        },
        currentState,
        attachmentList,
        attempt: job.attemptsMade + 1,
        workingDir: execution.attachmentDir,
      };

      // 5. Create agent task record
      const agentTask = await prisma.agentTask.create({
        data: {
          executionId,
          agentName,
          attemptNumber: context.attempt,
          status: 'PROCESSING',
          startedAt: new Date(),
          inputSnapshotId: latestSnapshot?.id,
        },
      });

      // 6. Instantiate and execute agent
      const agent = agentFactory[agentName]();
      const result = await agent.execute(context);

      // 7. Save output snapshot
      const outputSnapshot = await prisma.rfqSnapshot.create({
        data: {
          executionId,
          agentName,
          snapshotType: 'OUTPUT',
          data: { ...currentState, ...result.outputState },
        },
      });

      // 8. Save events
      await eventService.saveMany(
        result.events.map((e) => ({
          ...e,
          executionId,
          agentTaskId: agentTask.id,
        }))
      );

      // 9. Update agent task
      await prisma.agentTask.update({
        where: { id: agentTask.id },
        data: {
          status: result.success ? 'COMPLETED' : 'FAILED',
          completedAt: new Date(),
          outputSnapshotId: outputSnapshot.id,
          durationMs: result.metadata?.durationMs,
          tokenUsage: result.metadata?.tokenUsage as any,
          costUsd: result.metadata?.costUsd,
          errorMessage: result.success
            ? null
            : result.nextAction.type === 'FAIL'
            ? result.nextAction.error
            : null,
        },
      });

      // 10. Handle next action
      switch (result.nextAction.type) {
        case 'CONTINUE':
          await prisma.execution.update({
            where: { id: executionId },
            data: { currentAgent: result.nextAction.nextAgent },
          });
          await queueService.enqueue(result.nextAction.nextAgent, { executionId });
          break;

        case 'SKIP':
          await prisma.execution.update({
            where: { id: executionId },
            data: { currentAgent: result.nextAction.nextAgent },
          });
          await queueService.enqueue(result.nextAction.nextAgent, { executionId });
          logger.info(
            { executionId, skippedAgent: agentName, reason: result.nextAction.reason },
            'Agent skipped'
          );
          break;

        case 'AWAIT_HUMAN':
          await prisma.execution.update({
            where: { id: executionId },
            data: {
              status: 'AWAITING_HUMAN',
              metadata: {
                ...(execution.metadata as object || {}),
                awaitingReason: result.nextAction.reason,
                requiredFields: result.nextAction.requiredFields,
              },
            },
          });
          break;

        case 'COMPLETE':
          await prisma.execution.update({
            where: { id: executionId },
            data: {
              status: 'COMPLETED',
              completedAt: new Date(),
            },
          });
          await eventService.save({
            id: crypto.randomUUID(),
            executionId,
            eventType: 'EXECUTION_COMPLETED',
            eventData: {},
            createdAt: new Date(),
          });
          break;

        case 'FAIL':
          await prisma.execution.update({
            where: { id: executionId },
            data: {
              status: 'FAILED',
              metadata: {
                ...(execution.metadata as object || {}),
                error: result.nextAction.error,
              },
            },
          });
          await eventService.save({
            id: crypto.randomUUID(),
            executionId,
            eventType: 'EXECUTION_FAILED',
            eventData: { error: result.nextAction.error },
            createdAt: new Date(),
          });
          break;
      }

      return result;
    },
    {
      connection: redisConnection,
      concurrency: 5,
    }
  );
}

/**
 * Start all agent workers
 */
export function startAllWorkers(): Worker[] {
  const workers: Worker[] = [];

  for (const agentName of AGENT_PIPELINE) {
    const worker = createAgentWorker(agentName);

    worker.on('completed', (job) => {
      logger.info({ jobId: job.id, agent: agentName }, 'Job completed');
    });

    worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, agent: agentName, error: err.message }, 'Job failed');
    });

    workers.push(worker);
    logger.info({ agent: agentName }, 'Worker started');
  }

  return workers;
}
```

---

## 8. Agent Implementations

### 8.1 Intake Agent

Create file: `src/agents/intake/intake.agent.ts`

```typescript
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { BaseAgent } from '../base/base-agent';
import { AgentContext, NextAction } from '../../shared/types/agent.types';
import { RfqState } from '../../shared/types/rfq.types';
import { prompts } from '../../prompts';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

// Zod schema for intake output validation
export const IntakeOutputSchema = z.object({
  customerName: z.string().optional(),
  projectName: z.string().optional(),
  projectReference: z.string().optional(),
  requestedProducts: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().optional(),
      unit: z.string().optional(),
      specifications: z.record(z.unknown()).optional(),
      drawings: z.array(z.string()).optional(),
    })
  ),
  timeline: z.string().optional(),
  specialRequirements: z.array(z.string()).optional(),
  extractedFromAttachments: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
  uncertainFields: z.array(z.string()).optional(),
});

export type IntakeOutput = z.infer<typeof IntakeOutputSchema>;

export class IntakeAgent extends BaseAgent<IntakeOutput> {
  constructor() {
    super('intake');
  }

  protected buildSystemPrompt(context: AgentContext): string {
    return prompts.intake.system({
      companyName: 'Oldcastle BuildingEnvelope',
      supportedProducts: [
        'Curtain Wall Systems',
        'Storefront Systems',
        'Window Systems',
        'Entrance Systems',
        'Skylights',
        'Glass Products',
      ],
      currentDate: new Date().toISOString().split('T')[0],
    });
  }

  protected buildUserPrompt(context: AgentContext): string {
    return prompts.intake.user({
      senderEmail: context.input.senderEmail,
      receivedAt: context.input.receivedAt,
      emailBody: context.input.emailBody,
      attachmentDir: context.input.attachmentDir,
      attachmentList: context.attachmentList,
    });
  }

  protected createMcpServer(context: AgentContext) {
    const readAttachment = tool(
      'read_attachment',
      'Read the contents of an attachment file. Supports text files, PDFs, and images.',
      {
        filename: z.string().describe('The filename to read from the attachments directory'),
      },
      async ({ filename }) => {
        const filePath = join(context.input.attachmentDir, filename);
        try {
          // For text files, read directly
          const content = await readFile(filePath, 'utf-8');
          return {
            content: [{ type: 'text' as const, text: content }],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    const listAttachments = tool(
      'list_attachments',
      'List all available attachments in the RFQ directory',
      {},
      async () => {
        const files = await readdir(context.input.attachmentDir).catch(() => []);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ files, count: files.length }, null, 2),
            },
          ],
        };
      }
    );

    return createSdkMcpServer({
      name: 'intake-tools',
      version: '1.0.0',
      tools: [readAttachment, listAttachments],
    });
  }

  protected async parseOutput(
    result: { result: string },
    context: AgentContext
  ): Promise<{ state: Partial<RfqState>; output: IntakeOutput }> {
    const parsed = this.extractJsonFromResponse(result.result);
    const validated = IntakeOutputSchema.parse(parsed);

    return {
      state: {
        parsedData: {
          customerName: validated.customerName,
          projectName: validated.projectName,
          projectReference: validated.projectReference,
          requestedProducts: validated.requestedProducts,
          timeline: validated.timeline,
          specialRequirements: validated.specialRequirements,
        },
      },
      output: validated,
    };
  }

  protected determineNextAction(
    parsedOutput: { state: Partial<RfqState>; output: IntakeOutput },
    context: AgentContext
  ): NextAction {
    const { output } = parsedOutput;

    // If confidence is too low, require human intervention
    if (output.confidence < 0.7) {
      return this.requireHumanIntervention(
        'Low confidence in RFQ parsing - please review extracted data',
        output.uncertainFields
      );
    }

    // If no products identified, require human intervention
    if (!output.requestedProducts || output.requestedProducts.length === 0) {
      return this.requireHumanIntervention(
        'Could not identify any products in the RFQ',
        ['requestedProducts']
      );
    }

    // Continue to next agent
    return this.continueToNextAgent();
  }
}
```

### 8.2 Remaining Agents (Template)

Each remaining agent follows the same pattern. Create similar files for:

- `src/agents/missing-info/missing-info.agent.ts`
- `src/agents/duplicate/duplicate.agent.ts`
- `src/agents/prioritization/prioritization.agent.ts`
- `src/agents/mto/mto.agent.ts`
- `src/agents/auto-quote/auto-quote.agent.ts`

See Section 8.3 for the specific requirements of each agent.

### 8.3 Agent-Specific Requirements

| Agent | Input | Output | Tools | Human Intervention Triggers |
|-------|-------|--------|-------|---------------------------|
| **Intake** | Email body, attachments | Parsed RFQ data | `read_attachment`, `list_attachments` | Confidence < 0.7, No products found |
| **Missing Info** | Parsed data | Missing fields, clarification questions | `search_history`, `template_email` | Critical fields missing |
| **Duplicate** | Parsed data | Duplicate flag, similar RFQs | `search_rfq_database`, `compare_rfq` | High similarity match found |
| **Prioritization** | Parsed data | Priority, complexity, estimated hours | `check_capacity`, `get_rules` | Edge cases in classification |
| **MTO** | Parsed data, priority | Material take-off line items | `product_lookup`, `calculate_quantities` | Complex specifications |
| **Auto-Quote** | MTO data | Quote with pricing | `get_pricing`, `apply_discounts` | Complex pricing, high value |

---

## 9. Prompt Templating System

### 9.1 Template Engine

Create file: `src/prompts/engine.ts`

```typescript
import Handlebars from 'handlebars';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../shared/utils/logger';

// Register custom helpers
Handlebars.registerHelper('json', (context) => JSON.stringify(context, null, 2));

Handlebars.registerHelper('uppercase', (str: string) => str?.toUpperCase());

Handlebars.registerHelper('lowercase', (str: string) => str?.toLowerCase());

Handlebars.registerHelper('ifEquals', function (this: any, arg1: any, arg2: any, options: Handlebars.HelperOptions) {
  return arg1 === arg2 ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('ifNotEquals', function (this: any, arg1: any, arg2: any, options: Handlebars.HelperOptions) {
  return arg1 !== arg2 ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('formatDate', (date: Date | string) => {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString();
});

Handlebars.registerHelper('formatDateShort', (date: Date | string) => {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
});

Handlebars.registerHelper('truncate', (str: string, length: number) => {
  if (!str) return '';
  return str.length > length ? str.substring(0, length) + '...' : str;
});

Handlebars.registerHelper('default', (value: any, defaultValue: any) => {
  return value ?? defaultValue;
});

// Template cache
const templateCache = new Map<string, Handlebars.TemplateDelegate>();

/**
 * Initialize all templates from the templates directory
 */
export function initializeTemplates(templatesDir: string): void {
  const files = readdirSync(templatesDir).filter((f) => f.endsWith('.hbs'));

  for (const file of files) {
    const templateName = file.replace('.hbs', '');
    const templatePath = join(templatesDir, file);
    const templateSource = readFileSync(templatePath, 'utf-8');

    try {
      templateCache.set(templateName, Handlebars.compile(templateSource));
    } catch (error) {
      logger.error({ template: templateName, error }, 'Failed to compile template');
      throw error;
    }
  }

  logger.info({ count: templateCache.size }, 'Prompt templates loaded');
}

/**
 * Render a template with the given context
 */
export function renderPrompt<T extends Record<string, unknown>>(
  templateName: string,
  context: T
): string {
  const template = templateCache.get(templateName);
  if (!template) {
    throw new Error(`Template not found: ${templateName}`);
  }
  return template(context);
}

/**
 * Get all available template names
 */
export function getAvailableTemplates(): string[] {
  return Array.from(templateCache.keys());
}

/**
 * Check if a template exists
 */
export function hasTemplate(templateName: string): boolean {
  return templateCache.has(templateName);
}
```

### 9.2 Prompt Index

Create file: `src/prompts/index.ts`

```typescript
import { join } from 'path';
import { initializeTemplates, renderPrompt } from './engine';
import {
  IntakeSystemContext,
  IntakeUserContext,
  MissingInfoSystemContext,
  MissingInfoUserContext,
  DuplicateSystemContext,
  DuplicateUserContext,
  PrioritizationSystemContext,
  PrioritizationUserContext,
  MtoSystemContext,
  MtoUserContext,
  AutoQuoteSystemContext,
  AutoQuoteUserContext,
} from './types';

// Initialize templates at module load
const TEMPLATES_DIR = join(__dirname, 'templates');
initializeTemplates(TEMPLATES_DIR);

/**
 * Type-safe prompt accessors for all agents
 */
export const prompts = {
  intake: {
    system: (ctx: IntakeSystemContext) => renderPrompt('intake.system', ctx),
    user: (ctx: IntakeUserContext) => renderPrompt('intake.user', ctx),
  },
  missingInfo: {
    system: (ctx: MissingInfoSystemContext) => renderPrompt('missing-info.system', ctx),
    user: (ctx: MissingInfoUserContext) => renderPrompt('missing-info.user', ctx),
  },
  duplicate: {
    system: (ctx: DuplicateSystemContext) => renderPrompt('duplicate.system', ctx),
    user: (ctx: DuplicateUserContext) => renderPrompt('duplicate.user', ctx),
  },
  prioritization: {
    system: (ctx: PrioritizationSystemContext) => renderPrompt('prioritization.system', ctx),
    user: (ctx: PrioritizationUserContext) => renderPrompt('prioritization.user', ctx),
  },
  mto: {
    system: (ctx: MtoSystemContext) => renderPrompt('mto.system', ctx),
    user: (ctx: MtoUserContext) => renderPrompt('mto.user', ctx),
  },
  autoQuote: {
    system: (ctx: AutoQuoteSystemContext) => renderPrompt('auto-quote.system', ctx),
    user: (ctx: AutoQuoteUserContext) => renderPrompt('auto-quote.user', ctx),
  },
};
```

### 9.3 Template Context Types

Create file: `src/prompts/types.ts`

```typescript
import { RfqState, ProductRequest, MaterialTakeOff } from '../shared/types/rfq.types';

// ============================================
// Intake Agent
// ============================================

export interface IntakeSystemContext {
  companyName: string;
  supportedProducts: string[];
  currentDate: string;
}

export interface IntakeUserContext {
  senderEmail: string;
  receivedAt: Date;
  emailBody: string;
  attachmentDir: string;
  attachmentList: string[];
}

// ============================================
// Missing Info Agent
// ============================================

export interface MissingInfoSystemContext {
  companyName: string;
  requiredFields: string[];
  optionalFields: string[];
}

export interface MissingInfoUserContext {
  parsedData: RfqState['parsedData'];
  customerName?: string;
  projectName?: string;
}

// ============================================
// Duplicate Agent
// ============================================

export interface DuplicateSystemContext {
  companyName: string;
  similarityThreshold: number;
  lookbackDays: number;
}

export interface DuplicateUserContext {
  parsedData: RfqState['parsedData'];
  senderEmail: string;
  recentRfqs?: Array<{
    id: string;
    customerName: string;
    projectName: string;
    createdAt: string;
  }>;
}

// ============================================
// Prioritization Agent
// ============================================

export interface PrioritizationSystemContext {
  companyName: string;
  priorityRules: Array<{
    condition: string;
    priority: string;
  }>;
  complexityRules: Array<{
    condition: string;
    complexity: string;
  }>;
}

export interface PrioritizationUserContext {
  parsedData: RfqState['parsedData'];
  customerName?: string;
  timeline?: string;
  productCount: number;
  hasDrawings: boolean;
  hasSpecialRequirements: boolean;
}

// ============================================
// MTO Agent
// ============================================

export interface MtoSystemContext {
  companyName: string;
  productCatalog: Array<{
    code: string;
    name: string;
    category: string;
  }>;
  unitConversions: Record<string, number>;
}

export interface MtoUserContext {
  parsedData: RfqState['parsedData'];
  requestedProducts: ProductRequest[];
  priority: string;
  complexity: string;
}

// ============================================
// Auto-Quote Agent
// ============================================

export interface AutoQuoteSystemContext {
  companyName: string;
  quotePolicies: string[];
  discountRules: Array<{
    condition: string;
    discount: number;
  }>;
  taxRate: number;
}

export interface AutoQuoteUserContext {
  parsedData: RfqState['parsedData'];
  mtoData: MaterialTakeOff;
  customerName?: string;
  priority: string;
  complexity: string;
}
```

### 9.4 Example Templates

Create file: `src/prompts/templates/intake.system.hbs`

```handlebars
You are an RFQ Intake Agent for {{companyName}}.

Your role is to parse incoming Request for Quote (RFQ) emails and extract structured information accurately.

## Supported Product Categories
{{#each supportedProducts}}
- {{this}}
{{/each}}

## Your Tasks

1. **Read and Understand**: Carefully read the email body to understand the customer's request
2. **Process Attachments**: Use the provided tools to read any attachments (PDFs, drawings, specifications)
3. **Extract Information**: Identify and extract the following key information:
   - Customer/Company name
   - Project name or reference number
   - Requested products with quantities and specifications
   - Timeline or deadline mentioned
   - Any special requirements or notes

## Output Requirements

Return your findings as a JSON object with this structure:

```json
{
  "customerName": "string or null",
  "projectName": "string or null",
  "projectReference": "string or null",
  "requestedProducts": [
    {
      "name": "product name",
      "quantity": number or null,
      "unit": "string or null",
      "specifications": { ... },
      "drawings": ["list of referenced drawings"]
    }
  ],
  "timeline": "string or null",
  "specialRequirements": ["list of special requirements"],
  "extractedFromAttachments": ["list of attachment filenames processed"],
  "confidence": 0.0 to 1.0,
  "uncertainFields": ["list of fields with low confidence"]
}
```

## Important Guidelines

- Do NOT make assumptions about quantities or specifications - mark uncertain fields
- If drawings reference standards (ASTM, AAMA, etc.), note them in specifications
- Flag any potential issues or items needing clarification
- Set confidence below 0.7 if critical information is unclear
- Always list which attachments you processed

Current Date: {{currentDate}}
```

Create file: `src/prompts/templates/intake.user.hbs`

```handlebars
## RFQ Email to Process

**From:** {{senderEmail}}
**Received:** {{formatDate receivedAt}}

### Email Body

{{emailBody}}

### Attachments

**Directory:** {{attachmentDir}}

**Available Files:**
{{#if attachmentList.length}}
{{#each attachmentList}}
- {{this}}
{{/each}}
{{else}}
No attachments found.
{{/if}}

---

Please analyze this RFQ and extract all relevant information. Use the available tools to read attachment contents as needed.
```

---

## 10. API Endpoints

### 10.1 Execution Routes

Create file: `src/api/routes/executions.route.ts`

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { executionService } from '../../core/execution/execution.service';

// Request schemas
const CreateExecutionSchema = z.object({
  emailBody: z.string().min(1),
  attachmentDir: z.string().min(1),
  senderEmail: z.string().email(),
  receivedAt: z.string().datetime(),
  externalRef: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const ResumeExecutionSchema = z.object({
  updatedState: z.record(z.unknown()).optional(),
  resumeFromAgent: z.enum([
    'intake',
    'missing-info',
    'duplicate',
    'prioritization',
    'mto',
    'auto-quote',
  ]).optional(),
});

const ReplayExecutionSchema = z.object({
  fromAgent: z.enum([
    'intake',
    'missing-info',
    'duplicate',
    'prioritization',
    'mto',
    'auto-quote',
  ]),
});

export async function executionRoutes(fastify: FastifyInstance) {
  // Create new execution
  fastify.post(
    '/executions',
    async (
      request: FastifyRequest<{ Body: z.infer<typeof CreateExecutionSchema> }>,
      reply: FastifyReply
    ) => {
      const body = CreateExecutionSchema.parse(request.body);

      const executionId = await executionService.create({
        ...body,
        receivedAt: new Date(body.receivedAt),
      });

      return reply.status(201).send({
        success: true,
        executionId,
      });
    }
  );

  // Get execution by ID
  fastify.get(
    '/executions/:executionId',
    async (
      request: FastifyRequest<{ Params: { executionId: string } }>,
      reply: FastifyReply
    ) => {
      const { executionId } = request.params;
      const execution = await executionService.getById(executionId);

      if (!execution) {
        return reply.status(404).send({
          success: false,
          error: 'Execution not found',
        });
      }

      return reply.send({
        success: true,
        execution,
      });
    }
  );

  // Get execution history
  fastify.get(
    '/executions/:executionId/history',
    async (
      request: FastifyRequest<{ Params: { executionId: string } }>,
      reply: FastifyReply
    ) => {
      const { executionId } = request.params;
      const history = await executionService.getHistory(executionId);

      return reply.send({
        success: true,
        ...history,
      });
    }
  );

  // Resume execution after human intervention
  fastify.post(
    '/executions/:executionId/resume',
    async (
      request: FastifyRequest<{
        Params: { executionId: string };
        Body: z.infer<typeof ResumeExecutionSchema>;
      }>,
      reply: FastifyReply
    ) => {
      const { executionId } = request.params;
      const body = ResumeExecutionSchema.parse(request.body);

      await executionService.resume(executionId, body);

      return reply.send({
        success: true,
        message: 'Execution resumed',
      });
    }
  );

  // Replay execution from a specific agent
  fastify.post(
    '/executions/:executionId/replay',
    async (
      request: FastifyRequest<{
        Params: { executionId: string };
        Body: z.infer<typeof ReplayExecutionSchema>;
      }>,
      reply: FastifyReply
    ) => {
      const { executionId } = request.params;
      const body = ReplayExecutionSchema.parse(request.body);

      const newExecutionId = await executionService.replay(
        executionId,
        body.fromAgent
      );

      return reply.status(201).send({
        success: true,
        newExecutionId,
        replayedFrom: executionId,
        fromAgent: body.fromAgent,
      });
    }
  );

  // Cancel execution
  fastify.post(
    '/executions/:executionId/cancel',
    async (
      request: FastifyRequest<{ Params: { executionId: string } }>,
      reply: FastifyReply
    ) => {
      const { executionId } = request.params;
      await executionService.cancel(executionId);

      return reply.send({
        success: true,
        message: 'Execution cancelled',
      });
    }
  );

  // List executions with filtering
  fastify.get(
    '/executions',
    async (
      request: FastifyRequest<{
        Querystring: {
          status?: string;
          limit?: string;
          offset?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { status, limit = '20', offset = '0' } = request.query;

      // Implementation would query with filters
      // This is a placeholder
      return reply.send({
        success: true,
        executions: [],
        total: 0,
        limit: parseInt(limit),
        offset: parseInt(offset),
      });
    }
  );
}
```

### 10.2 API Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/executions` | Create new RFQ execution |
| `GET` | `/executions/:id` | Get execution status and details |
| `GET` | `/executions/:id/history` | Get full audit history |
| `POST` | `/executions/:id/resume` | Resume after human intervention |
| `POST` | `/executions/:id/replay` | Replay from specific agent |
| `POST` | `/executions/:id/cancel` | Cancel execution |
| `GET` | `/executions` | List executions with filters |
| `GET` | `/health` | Health check |
| `GET` | `/health/ready` | Readiness check (DB + Redis) |

---

## 11. Configuration

### 11.1 Environment Variables

Create file: `.env.example`

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
REDIS_PASSWORD=

# Anthropic API
ANTHROPIC_API_KEY=your_api_key_here

# Agent Configuration
AGENT_MAX_TURNS=15
AGENT_CONCURRENCY=5

# Queue Configuration
QUEUE_JOB_ATTEMPTS=3
QUEUE_BACKOFF_DELAY=1000
```

### 11.2 Configuration Module

Create file: `src/config/index.ts`

```typescript
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const ConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3000),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  database: z.object({
    url: z.string().url(),
  }),

  redis: z.object({
    host: z.string().default('localhost'),
    port: z.coerce.number().default(6379),
    password: z.string().optional(),
  }),

  anthropic: z.object({
    apiKey: z.string().min(1),
  }),

  agent: z.object({
    maxTurns: z.coerce.number().default(15),
    concurrency: z.coerce.number().default(5),
  }),

  queue: z.object({
    jobAttempts: z.coerce.number().default(3),
    backoffDelay: z.coerce.number().default(1000),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

export const config: Config = ConfigSchema.parse({
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT,
  logLevel: process.env.LOG_LEVEL,

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD,
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },

  agent: {
    maxTurns: process.env.AGENT_MAX_TURNS,
    concurrency: process.env.AGENT_CONCURRENCY,
  },

  queue: {
    jobAttempts: process.env.QUEUE_JOB_ATTEMPTS,
    backoffDelay: process.env.QUEUE_BACKOFF_DELAY,
  },
});
```

---

## 12. Development Setup

### 12.1 Prerequisites

- Node.js 18+
- Docker and Docker Compose
- pnpm (recommended) or npm

### 12.2 Setup Steps

```bash
# 1. Clone and install dependencies
git clone <repository>
cd rfq-automation
pnpm install

# 2. Start infrastructure (PostgreSQL + Redis)
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
```

### 12.3 Package.json Scripts

```json
{
  "scripts": {
    "build": "tsc",
    "dev:api": "tsx watch src/main.ts",
    "dev:workers": "tsx watch src/workers/index.ts",
    "start": "node dist/main.js",
    "start:workers": "node dist/workers/index.js",

    "db:generate": "prisma generate",
    "db:migrate:dev": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:push": "prisma db push",
    "db:seed": "tsx prisma/seed.ts",
    "db:studio": "prisma studio",

    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "test:e2e": "vitest --config vitest.e2e.config.ts",

    "lint": "eslint src --ext .ts",
    "lint:fix": "eslint src --ext .ts --fix",
    "format": "prettier --write src",

    "typecheck": "tsc --noEmit"
  }
}
```

### 12.4 Docker Compose

Create file: `docker-compose.yml`

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: rfq-postgres
    environment:
      POSTGRES_USER: rfq_user
      POSTGRES_PASSWORD: rfq_password
      POSTGRES_DB: rfq_automation
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U rfq_user -d rfq_automation']
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: rfq-redis
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

---

## 13. Implementation Phases
TBD
---

## 14. Testing Strategy
TBD
---

## 15. Deployment
TBD
---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **RFQ** | Request for Quote - Customer inquiry for pricing |
| **MTO** | Material Take-Off - List of materials needed |
| **Execution** | Single RFQ processing instance |
| **Agent Task** | Individual agent's processing within an execution |
| **Snapshot** | Point-in-time capture of RFQ state |
| **Event** | Immutable record of a state change |

---

## Appendix B: References

- [Claude Agent SDK Documentation](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Claude Agent SDK GitHub](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Prisma Documentation](https://www.prisma.io/docs)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Handlebars Documentation](https://handlebarsjs.com/)
