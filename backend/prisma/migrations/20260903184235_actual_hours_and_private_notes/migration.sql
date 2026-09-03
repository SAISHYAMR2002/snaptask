-- Adds Task.actualHours and the PrivateNote table.
--
-- NOTE FOR THE NEXT MIGRATION: `prisma migrate dev` regenerated statements to
-- DROP the four full-text indexes and strip the GENERATED ALWAYS expressions
-- off the three searchVector columns. Prisma cannot represent either in
-- schema.prisma, so it believes they are drift and "corrects" them every time.
-- Those statements were removed by hand here, and must be removed by hand from
-- any future migration too. (Postgres refuses the DROP DEFAULT outright, which
-- is what surfaced it — but the DROP INDEX statements would have succeeded
-- silently and quietly deleted the search indexes.)

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "actualHours" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "PrivateNote" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "remindAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authorId" TEXT NOT NULL,
    "subjectId" TEXT,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT,

    CONSTRAINT "PrivateNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrivateNote_authorId_workspaceId_idx" ON "PrivateNote"("authorId", "workspaceId");

-- CreateIndex
CREATE INDEX "PrivateNote_authorId_subjectId_idx" ON "PrivateNote"("authorId", "subjectId");

-- CreateIndex
CREATE INDEX "PrivateNote_remindAt_idx" ON "PrivateNote"("remindAt");

-- AddForeignKey
ALTER TABLE "PrivateNote" ADD CONSTRAINT "PrivateNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateNote" ADD CONSTRAINT "PrivateNote_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateNote" ADD CONSTRAINT "PrivateNote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateNote" ADD CONSTRAINT "PrivateNote_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
