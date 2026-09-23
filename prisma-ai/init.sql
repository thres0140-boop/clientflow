-- ─────────────────────────────────────────────────────────────────────────────
-- Bootstrap DDL for the AI-business database (EMPTY target only).
-- Generated from prisma-ai/schema.prisma with:
--   npx prisma migrate diff --from-empty --to-schema-datamodel prisma-ai/schema.prisma --script
-- Apply once to the new Neon database (Neon SQL editor or psql). Not idempotent:
-- it uses plain CREATE TABLE, so never run it against a database that has tables.
-- Regenerate with `npm run db:ai:init-sql` after schema changes if you ever need
-- to bootstrap another empty database.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "Workspace" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3d4aa3',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" SERIAL NOT NULL,
    "workspaceId" INTEGER,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "profileUrl" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "notes" TEXT,
    "captionStyle" TEXT,
    "captionGuidelines" TEXT,
    "dayTemplate" TEXT,
    "language" TEXT NOT NULL DEFAULT 'nl',
    "scriptAlternatives" INTEGER NOT NULL DEFAULT 5,
    "generationInterval" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bookingLink" TEXT,
    "scriptRules" TEXT,
    "ctaKeyword" TEXT,
    "isTestAccount" BOOLEAN NOT NULL DEFAULT false,
    "hideFromHq" BOOLEAN NOT NULL DEFAULT false,
    "instagramEnabled" BOOLEAN NOT NULL DEFAULT true,
    "tiktokEnabled" BOOLEAN NOT NULL DEFAULT false,
    "tiktokHandle" TEXT,
    "tiktokProfileData" TEXT,
    "tiktokProfileAt" TIMESTAMP(3),
    "tiktokAccessToken" TEXT,
    "tiktokRefreshToken" TEXT,
    "tiktokTokenExpiresAt" TIMESTAMP(3),
    "tiktokOpenId" TEXT,
    "tiktokScope" TEXT,
    "tiktokZernioAccountId" TEXT,
    "tiktokZernioUsername" TEXT,
    "tiktokZernioProfileId" TEXT,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramConnection" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "accessToken" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "igUsername" TEXT,
    "followers" INTEGER,
    "unipileAccountId" TEXT,
    "zernioAccountId" TEXT,
    "zernioProfileId" TEXT,
    "profilePictureUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creator" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'instagram',
    "name" TEXT NOT NULL,
    "email" TEXT,
    "instagramHandle" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT 'owner',
    "channel" TEXT NOT NULL DEFAULT 'client',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "pageAccess" TEXT NOT NULL DEFAULT 'all',
    "viewOnlyPages" TEXT NOT NULL DEFAULT '',
    "isClientAccount" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "inviteToken" TEXT,
    "inviteTokenExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" SERIAL NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "subscriberType" TEXT NOT NULL DEFAULT 'owner',
    "memberId" INTEGER,
    "clientId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStage" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER,
    "platform" TEXT NOT NULL DEFAULT 'instagram',
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "assignedToId" INTEGER,
    "assignedCreatorId" INTEGER,
    "assignedToOwner" BOOLEAN NOT NULL DEFAULT false,
    "assignedToClient" BOOLEAN NOT NULL DEFAULT false,
    "assignees" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageHistory" (
    "id" SERIAL NOT NULL,
    "contentId" INTEGER NOT NULL,
    "stageId" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completedById" INTEGER,
    "notes" TEXT,
    "rawContentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "contentId" INTEGER NOT NULL,
    "stageId" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'instagram',
    "handle" TEXT NOT NULL,
    "name" TEXT,
    "niche" TEXT,
    "tags" TEXT,
    "followerCount" INTEGER,
    "followingCount" INTEGER,
    "postCount" INTEGER,
    "bio" TEXT,
    "profilePicUrl" TEXT,
    "verified" BOOLEAN,
    "lastProfileSyncAt" TIMESTAMP(3),
    "notes" TEXT,
    "profileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScrapedAt" TIMESTAMP(3),
    "lastScrapeError" TEXT,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorCandidate" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'instagram',
    "handle" TEXT NOT NULL,
    "name" TEXT,
    "followerCount" INTEGER,
    "profilePicUrl" TEXT,
    "matched" TEXT,
    "bio" TEXT,
    "gender" TEXT,
    "language" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConceptExample" (
    "id" SERIAL NOT NULL,
    "conceptId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "hookKey" TEXT,
    "scriptDraftId" INTEGER,
    "reelShortcode" TEXT,
    "format" TEXT,
    "views" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConceptExample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorReel" (
    "id" SERIAL NOT NULL,
    "competitorId" INTEGER NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'instagram',
    "shortcode" TEXT NOT NULL,
    "caption" TEXT,
    "thumbnailUrl" TEXT,
    "mediaUrl" TEXT,
    "mediaUrlAt" TIMESTAMP(3),
    "cachedVideoUrl" TEXT,
    "transcript" TEXT,
    "transcriptAt" TIMESTAMP(3),
    "captureStatus" TEXT,
    "captureTries" INTEGER NOT NULL DEFAULT 0,
    "permalink" TEXT,
    "postedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "format" TEXT,

    CONSTRAINT "CompetitorReel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorReelSnapshot" (
    "id" SERIAL NOT NULL,
    "reelId" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewCount" INTEGER,
    "likeCount" INTEGER,
    "commentCount" INTEGER,

    CONSTRAINT "CompetitorReelSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TikTokInstructions" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TikTokInstructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TikTokVideoConcept" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "videoId" TEXT NOT NULL,
    "conceptId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TikTokVideoConcept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TikTokDailySnapshot" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "day" TEXT NOT NULL,
    "followerCount" INTEGER,
    "followingCount" INTEGER,
    "likesCount" INTEGER,
    "videoCount" INTEGER,
    "totalViews" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TikTokDailySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Board" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL DEFAULT '{}',
    "pendingVideos" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Concept" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER,
    "platform" TEXT NOT NULL DEFAULT 'instagram',
    "name" TEXT NOT NULL,
    "conceptType" TEXT,
    "hookType" TEXT,
    "textHook" TEXT,
    "audioHook" TEXT,
    "videoType" TEXT,
    "angle" TEXT,
    "structure" TEXT,
    "guidelines" TEXT,
    "exampleUrl" TEXT,
    "reelUrls" TEXT,
    "postDays" TEXT,
    "textOverlay" BOOLEAN NOT NULL DEFAULT false,
    "scriptExamples" TEXT,
    "scriptRules" TEXT,
    "aiMemory" TEXT,
    "memoryUpdatedAt" TIMESTAMP(3),
    "conversationHistory" TEXT NOT NULL DEFAULT '[]',
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "isIdea" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientOwned" BOOLEAN NOT NULL DEFAULT false,
    "clientQuota" INTEGER,
    "clientIntervalDays" INTEGER,
    "clientAnchor" TEXT,

    CONSTRAINT "Concept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptDraft" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'instagram',
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
    "rawContentUrl" TEXT,
    "rawContentUrls" TEXT NOT NULL DEFAULT '[]',
    "editedVideoUrl" TEXT,
    "uploadToken" TEXT,
    "checkReviewerIds" TEXT NOT NULL DEFAULT '[]',
    "scheduledDate" TEXT,
    "zernioBooked" BOOLEAN NOT NULL DEFAULT false,
    "zernioPostId" TEXT,
    "clientAuthored" BOOLEAN NOT NULL DEFAULT false,
    "isRemix" BOOLEAN NOT NULL DEFAULT false,
    "hookAlternatives" TEXT NOT NULL DEFAULT '[]',
    "rejectionFeedback" TEXT,
    "exampleVideoUrl" TEXT,
    "exampleLink" TEXT,
    "exampleReelId" INTEGER,
    "exampleThumbnail" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScriptDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftReview" (
    "id" SERIAL NOT NULL,
    "draftId" INTEGER NOT NULL,
    "reviewerName" TEXT NOT NULL,
    "reviewerId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPiece" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "conceptId" INTEGER,
    "title" TEXT NOT NULL,
    "script" TEXT,
    "contentType" TEXT NOT NULL DEFAULT 'video',
    "status" TEXT NOT NULL DEFAULT 'scripted',
    "platform" TEXT,
    "scheduledDate" TEXT,
    "hook" TEXT,
    "caption" TEXT,
    "notes" TEXT,
    "currentStageId" INTEGER,
    "rawContentUrl" TEXT,
    "igMediaId" TEXT,
    "zernioPostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentPiece_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedVideo" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "conceptId" INTEGER,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "hookUsed" TEXT,
    "hookType" TEXT,
    "datePosted" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackedVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEntry" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "conceptId" INTEGER,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "follows" INTEGER NOT NULL DEFAULT 0,
    "messagesSent" INTEGER NOT NULL DEFAULT 0,
    "messagesAnswered" INTEGER NOT NULL DEFAULT 0,
    "linksSent" INTEGER NOT NULL DEFAULT 0,
    "bookedCalls" INTEGER NOT NULL DEFAULT 0,
    "videoLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftNote" (
    "id" SERIAL NOT NULL,
    "draftId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "imageUrl" TEXT,
    "author" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftChange" (
    "id" SERIAL NOT NULL,
    "draftId" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "before" TEXT NOT NULL,
    "after" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmLead" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT,
    "status" TEXT NOT NULL DEFAULT 'messaged',
    "date" TEXT,
    "repliedAt" TEXT,
    "source" TEXT,
    "convId" TEXT,
    "linkSentAt" TEXT,
    "bookedAt" TEXT,
    "lastConvTime" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConceptFeedback" (
    "id" SERIAL NOT NULL,
    "conceptId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "hook" TEXT,
    "scriptSnippet" TEXT,
    "reasonType" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConceptFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER,
    "actor" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "detail" TEXT,
    "draftId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReelSnapshot" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "reelId" TEXT NOT NULL,
    "plays" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "takenAt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReelSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramConnection_clientId_key" ON "InstagramConnection"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_inviteToken_key" ON "TeamMember"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "CompetitorCandidate_clientId_platform_status_idx" ON "CompetitorCandidate"("clientId", "platform", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorCandidate_clientId_platform_handle_key" ON "CompetitorCandidate"("clientId", "platform", "handle");

-- CreateIndex
CREATE INDEX "ConceptExample_conceptId_source_idx" ON "ConceptExample"("conceptId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorReel_competitorId_shortcode_key" ON "CompetitorReel"("competitorId", "shortcode");

-- CreateIndex
CREATE INDEX "CompetitorReelSnapshot_reelId_capturedAt_idx" ON "CompetitorReelSnapshot"("reelId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TikTokInstructions_clientId_key" ON "TikTokInstructions"("clientId");

-- CreateIndex
CREATE INDEX "TikTokVideoConcept_clientId_conceptId_idx" ON "TikTokVideoConcept"("clientId", "conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "TikTokVideoConcept_clientId_videoId_key" ON "TikTokVideoConcept"("clientId", "videoId");

-- CreateIndex
CREATE INDEX "TikTokDailySnapshot_clientId_day_idx" ON "TikTokDailySnapshot"("clientId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "TikTokDailySnapshot_clientId_day_key" ON "TikTokDailySnapshot"("clientId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "Board_clientId_key" ON "Board"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ScriptDraft_uploadToken_key" ON "ScriptDraft"("uploadToken");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsEntry_clientId_date_key" ON "AnalyticsEntry"("clientId", "date");

-- CreateIndex
CREATE INDEX "ActivityEvent_createdAt_idx" ON "ActivityEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_clientId_createdAt_idx" ON "ActivityEvent"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ReelSnapshot_clientId_takenAt_idx" ON "ReelSnapshot"("clientId", "takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReelSnapshot_clientId_reelId_takenAt_key" ON "ReelSnapshot"("clientId", "reelId", "takenAt");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramConnection" ADD CONSTRAINT "InstagramConnection_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStage" ADD CONSTRAINT "WorkflowStage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStage" ADD CONSTRAINT "WorkflowStage_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStage" ADD CONSTRAINT "WorkflowStage_assignedCreatorId_fkey" FOREIGN KEY ("assignedCreatorId") REFERENCES "Creator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentPiece"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "WorkflowStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentPiece"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptExample" ADD CONSTRAINT "ConceptExample_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorReel" ADD CONSTRAINT "CompetitorReel_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorReelSnapshot" ADD CONSTRAINT "CompetitorReelSnapshot_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "CompetitorReel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Concept" ADD CONSTRAINT "Concept_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptDraft" ADD CONSTRAINT "ScriptDraft_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptDraft" ADD CONSTRAINT "ScriptDraft_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptDraft" ADD CONSTRAINT "ScriptDraft_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "WorkflowStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftReview" ADD CONSTRAINT "DraftReview_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ScriptDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPiece" ADD CONSTRAINT "ContentPiece_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPiece" ADD CONSTRAINT "ContentPiece_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedVideo" ADD CONSTRAINT "TrackedVideo_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedVideo" ADD CONSTRAINT "TrackedVideo_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEntry" ADD CONSTRAINT "AnalyticsEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEntry" ADD CONSTRAINT "AnalyticsEntry_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftNote" ADD CONSTRAINT "DraftNote_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ScriptDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftChange" ADD CONSTRAINT "DraftChange_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ScriptDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmLead" ADD CONSTRAINT "DmLead_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptFeedback" ADD CONSTRAINT "ConceptFeedback_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptFeedback" ADD CONSTRAINT "ConceptFeedback_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

