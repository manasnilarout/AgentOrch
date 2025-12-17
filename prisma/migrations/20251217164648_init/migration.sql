-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'PROCESSING', 'AWAITING_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentTaskStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'AWAITING_HUMAN', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SnapshotType" AS ENUM ('INPUT', 'OUTPUT', 'HUMAN_UPDATE');

-- CreateTable
CREATE TABLE "emails" (
    "id" TEXT NOT NULL,
    "subject" VARCHAR(500),
    "body" TEXT NOT NULL,
    "sender_email" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_attachments" (
    "id" TEXT NOT NULL,
    "email_id" TEXT NOT NULL,
    "filename" VARCHAR(500) NOT NULL,
    "original_name" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(255) NOT NULL,
    "size" INTEGER NOT NULL,
    "bucket_name" VARCHAR(255) NOT NULL,
    "object_key" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "executions" (
    "id" TEXT NOT NULL,
    "email_id" TEXT NOT NULL,
    "external_ref" TEXT,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "current_agent" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tasks" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'PENDING',
    "input_snapshot_id" TEXT,
    "output_snapshot_id" TEXT,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "token_usage" JSONB,
    "cost_usd" DECIMAL(10,6),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "agent_task_id" TEXT,
    "event_type" TEXT NOT NULL,
    "event_data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_snapshots" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "snapshot_type" "SnapshotType" NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfq_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emails_sender_email_idx" ON "emails"("sender_email");

-- CreateIndex
CREATE INDEX "emails_created_at_idx" ON "emails"("created_at");

-- CreateIndex
CREATE INDEX "emails_received_at_idx" ON "emails"("received_at");

-- CreateIndex
CREATE INDEX "email_attachments_email_id_idx" ON "email_attachments"("email_id");

-- CreateIndex
CREATE INDEX "email_attachments_mime_type_idx" ON "email_attachments"("mime_type");

-- CreateIndex
CREATE INDEX "executions_email_id_idx" ON "executions"("email_id");

-- CreateIndex
CREATE INDEX "executions_status_idx" ON "executions"("status");

-- CreateIndex
CREATE INDEX "executions_external_ref_idx" ON "executions"("external_ref");

-- CreateIndex
CREATE INDEX "executions_created_at_idx" ON "executions"("created_at");

-- CreateIndex
CREATE INDEX "agent_tasks_execution_id_idx" ON "agent_tasks"("execution_id");

-- CreateIndex
CREATE INDEX "agent_tasks_agent_name_idx" ON "agent_tasks"("agent_name");

-- CreateIndex
CREATE INDEX "agent_tasks_status_idx" ON "agent_tasks"("status");

-- CreateIndex
CREATE INDEX "agent_tasks_created_at_idx" ON "agent_tasks"("created_at");

-- CreateIndex
CREATE INDEX "events_execution_id_idx" ON "events"("execution_id");

-- CreateIndex
CREATE INDEX "events_agent_task_id_idx" ON "events"("agent_task_id");

-- CreateIndex
CREATE INDEX "events_event_type_idx" ON "events"("event_type");

-- CreateIndex
CREATE INDEX "events_created_at_idx" ON "events"("created_at");

-- CreateIndex
CREATE INDEX "rfq_snapshots_execution_id_idx" ON "rfq_snapshots"("execution_id");

-- CreateIndex
CREATE INDEX "rfq_snapshots_agent_name_idx" ON "rfq_snapshots"("agent_name");

-- CreateIndex
CREATE INDEX "rfq_snapshots_snapshot_type_idx" ON "rfq_snapshots"("snapshot_type");

-- CreateIndex
CREATE INDEX "rfq_snapshots_created_at_idx" ON "rfq_snapshots"("created_at");

-- AddForeignKey
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_input_snapshot_id_fkey" FOREIGN KEY ("input_snapshot_id") REFERENCES "rfq_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_output_snapshot_id_fkey" FOREIGN KEY ("output_snapshot_id") REFERENCES "rfq_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_agent_task_id_fkey" FOREIGN KEY ("agent_task_id") REFERENCES "agent_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_snapshots" ADD CONSTRAINT "rfq_snapshots_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
