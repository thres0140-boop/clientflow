import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Token-gated. Applies (POST) or reads (GET) the bucket CORS policy so the browser can
// upload large videos directly to R2 via presigned PUT. Without this, those uploads fail
// with "network/CORS error" because the cross-origin PUT is blocked by the browser.
const TOKEN = "zernio-migrate-2024";

const ALLOWED_ORIGINS = [
  "https://www.ordoagency.com",
  "https://ordoagency.com",
  "http://localhost:3000",
];

function client() {
  const accountId = process.env.R2_ACCOUNT_ID!;
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("token") !== TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const bucket = process.env.R2_BUCKET;
  if (!bucket || !process.env.R2_ACCOUNT_ID) {
    return NextResponse.json({ error: "R2 not configured" }, { status: 500 });
  }
  try {
    await client().send(new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ALLOWED_ORIGINS,
            AllowedMethods: ["PUT", "GET", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }));
    return NextResponse.json({ ok: true, applied: ALLOWED_ORIGINS });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("token") !== TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const bucket = process.env.R2_BUCKET;
  if (!bucket || !process.env.R2_ACCOUNT_ID) {
    return NextResponse.json({ error: "R2 not configured" }, { status: 500 });
  }
  try {
    const r = await client().send(new GetBucketCorsCommand({ Bucket: bucket }));
    return NextResponse.json({ ok: true, rules: r.CORSRules || [] });
  } catch (e) {
    return NextResponse.json({ error: String(e), rules: [] });
  }
}
