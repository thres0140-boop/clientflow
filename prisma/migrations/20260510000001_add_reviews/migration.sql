ALTER TABLE "ScriptDraft" ADD COLUMN "checkReviewerIds" TEXT NOT NULL DEFAULT '[]';

CREATE TABLE "DraftReview" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "draftId" INTEGER NOT NULL,
    "reviewerName" TEXT NOT NULL,
    "reviewerId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DraftReview_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ScriptDraft" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
