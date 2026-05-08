import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export async function POST(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Storage not configured — add BLOB_READ_WRITE_TOKEN in Vercel project settings (Storage → Blob)" },
      { status: 500 }
    );
  }

  try {
    const formData = await req.formData();
    const files = formData.getAll("file") as File[];
    if (!files.length) return NextResponse.json({ error: "No files" }, { status: 400 });

    const urls = await Promise.all(
      files.map((file) => put(file.name, file, { access: "public" }).then((b) => b.url))
    );
    return NextResponse.json({ urls });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
