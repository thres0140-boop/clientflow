-- CreateTable
CREATE TABLE "ScriptDraft" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL,
    "conceptId" INTEGER NOT NULL,
    "stageId" INTEGER,
    "title" TEXT NOT NULL,
    "hook" TEXT,
    "script" TEXT NOT NULL,
    "caption" TEXT,
    "weekLabel" TEXT NOT NULL,
    "dayLabel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "isSavedIdea" BOOLEAN NOT NULL DEFAULT false,
    "resurfaceAt" TEXT,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScriptDraft_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScriptDraft_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScriptDraft_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "WorkflowStage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Client" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "profileUrl" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "notes" TEXT,
    "captionStyle" TEXT,
    "language" TEXT NOT NULL DEFAULT 'nl',
    "scriptAlternatives" INTEGER NOT NULL DEFAULT 5,
    "generationInterval" INTEGER NOT NULL DEFAULT 2,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Client" ("captionStyle", "color", "createdAt", "id", "name", "notes", "platform", "profileUrl") SELECT "captionStyle", "color", "createdAt", "id", "name", "notes", "platform", "profileUrl" FROM "Client";
DROP TABLE "Client";
ALTER TABLE "new_Client" RENAME TO "Client";
CREATE TABLE "new_WorkflowStage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "assignedToId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowStage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkflowStage_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "TeamMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WorkflowStage" ("assignedToId", "color", "createdAt", "id", "name", "order") SELECT "assignedToId", "color", "createdAt", "id", "name", "order" FROM "WorkflowStage";
DROP TABLE "WorkflowStage";
ALTER TABLE "new_WorkflowStage" RENAME TO "WorkflowStage";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
