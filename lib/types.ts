export type Competitor = {
  id: number;
  clientId: number;
  handle: string;
  name?: string | null;
  niche?: string | null;
  followerCount?: number | null;
  notes?: string | null;
  profileUrl?: string | null;
  createdAt: string;
};

export type Creator = {
  id: number;
  clientId: number;
  name: string;
  email?: string | null;
  instagramHandle?: string | null;
  color: string;
  notes?: string | null;
  createdAt: string;
  client?: { name: string; color: string } | null;
};

export type Message = {
  id: number;
  clientId: number;
  content: string;
  author: string;
  createdAt: string;
};

export type Client = {
  id: number;
  name: string;
  platform: string;
  profileUrl?: string | null;
  color: string;
  notes?: string | null;
  captionStyle?: string | null;
  dayTemplate?: string | null;
  language: string;
  scriptAlternatives: number;
  generationInterval: number;
  bookingLink?: string | null;
  createdAt: string;
};

export type AnalyticsEntry = {
  id: number;
  clientId: number;
  date: string;
  conceptId?: number | null;
  views: number;
  likes: number;
  shares: number;
  follows: number;
  messagesSent: number;
  messagesAnswered: number;
  linksSent: number;
  bookedCalls: number;
  createdAt: string;
  updatedAt: string;
  concept?: { id: number; name: string } | null;
};

export type ScriptDraft = {
  id: number;
  clientId: number;
  conceptId: number;
  stageId?: number | null;
  title: string;
  hook?: string | null;
  script: string;
  caption?: string | null;
  weekLabel: string;
  dayLabel?: string | null;
  status: string;
  isSavedIdea: boolean;
  resurfaceAt?: string | null;
  generatedAt: string;
  concept?: { name: string; color?: string } | null;
  client?: { name: string; color: string };
  stage?: WorkflowStage | null;
};

export type TeamMember = {
  id: number;
  name: string;
  email?: string | null;
  role?: string | null;
  color: string;
  pageAccess: string; // "all" or comma-separated page ids e.g. "dashboard,pipeline,concepts"
  createdAt: string;
};

export type WorkflowStage = {
  id: number;
  clientId?: number | null;
  name: string;
  order: number;
  color: string;
  assignedToId?: number | null;
  assignedTo?: TeamMember | null;
  createdAt: string;
};

export type StageHistory = {
  id: number;
  contentId: number;
  stageId: number;
  completedAt?: string | null;
  completedById?: number | null;
  notes?: string | null;
  rawContentUrl?: string | null;
  stage?: WorkflowStage;
  completedBy?: TeamMember | null;
};

export type Notification = {
  id: number;
  memberId: number;
  contentId: number;
  stageId: number;
  message: string;
  read: boolean;
  createdAt: string;
  member?: { name: string; color: string };
  content?: { title: string; client?: { name: string } | null };
};

export type Concept = {
  id: number;
  clientId?: number | null;
  name: string;
  hookType?: string | null;
  textHook?: string | null;
  audioHook?: string | null;
  videoType?: string | null;
  angle?: string | null;
  structure?: string | null;
  guidelines?: string | null;
  exampleUrl?: string | null;
  scriptExamples?: string | null;
  timesUsed: number;
  isIdea: boolean;
  notes?: string | null;
  createdAt: string;
  client?: { name: string; color: string } | null;
};

export type ContentPiece = {
  id: number;
  clientId: number;
  conceptId?: number | null;
  title: string;
  script?: string | null;
  contentType: string;
  status: string;
  platform?: string | null;
  scheduledDate?: string | null;
  hook?: string | null;
  caption?: string | null;
  notes?: string | null;
  currentStageId?: number | null;
  rawContentUrl?: string | null;
  createdAt: string;
  client?: { name: string; color: string };
  concept?: { name: string } | null;
  stageHistory?: StageHistory[];
};

export type TrackedVideo = {
  id: number;
  clientId: number;
  conceptId?: number | null;
  title: string;
  url?: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  hookUsed?: string | null;
  hookType?: string | null;
  datePosted?: string | null;
  notes?: string | null;
  createdAt: string;
  client?: { name: string; color: string };
  concept?: { name: string } | null;
};

export type DmLead = {
  id: number;
  clientId: number;
  name: string;
  handle?: string | null;
  status: string;
  date?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

export const DM_STATUSES = [
  { value: "messaged",  label: "Messaged",  bg: "bg-indigo-50",  text: "text-indigo-700",  border: "border-indigo-200" },
  { value: "link_sent", label: "Link Sent", bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200"  },
  { value: "booked",    label: "Booked",    bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200"   },
  { value: "showed",    label: "Showed",    bg: "bg-green-50",   text: "text-green-700",   border: "border-green-200"  },
  { value: "no_show",   label: "No Show",   bg: "bg-red-50",     text: "text-red-600",     border: "border-red-200"    },
  { value: "closed",    label: "Closed",    bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200"},
] as const;

export const STATUSES = [
  { value: "scripted", label: "Scripted", bg: "bg-purple-100", text: "text-purple-700" },
  { value: "ready_to_film", label: "Ready to Film", bg: "bg-amber-100", text: "text-amber-700" },
  { value: "filmed", label: "Filmed", bg: "bg-blue-100", text: "text-blue-700" },
  { value: "edited", label: "Edited", bg: "bg-cyan-100", text: "text-cyan-700" },
  { value: "scheduled", label: "Scheduled", bg: "bg-orange-100", text: "text-orange-700" },
  { value: "posted", label: "Posted", bg: "bg-green-100", text: "text-green-700" },
] as const;

export const PLATFORMS = ["instagram", "tiktok", "youtube", "linkedin"];
export const CONTENT_TYPES = ["video", "photo", "carousel", "reel", "story"];

export const HOOK_TYPE_SUGGESTIONS = [
  "question", "statement", "statistic", "story", "controversy", "curiosity_gap", "challenge",
];

export const VIDEO_TYPE_SUGGESTIONS = [
  "talking_head", "broll", "screen_record", "voiceover", "interview", "montage", "tutorial",
];

export const MEMBER_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#06b6d4", "#64748b",
];
