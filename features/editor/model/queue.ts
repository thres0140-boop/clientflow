// A row of the CapCut cutting queue (GET /api/edit-projects/queue). Client-safe.
export type EditQueueRow = {
  draftId: number;
  title: string;
  client: { id: number; name: string; color: string };
  stage: { name: string; color: string } | null;
  clipCount: number;
  footageAt: string;      // when the newest raw clip arrived (from the upload key's timestamp)
  hasProject: boolean;    // an edit project already exists (someone started cutting)
};
