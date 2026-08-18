import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { jsonFromError } from "@/lib/api-utils";
import { query } from "@/lib/db";

export const runtime = "nodejs";

const resumeDir = "/Users/sanjaykumarv/Documents/resumes";

function pdfResponse(bytes: Uint8Array, fileName: string, contentType = "application/pdf") {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${fileName.replaceAll("\"", "")}"`
    }
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ file: string }> }
) {
  try {
    await requireSessionUser(request);
    const { file } = await context.params;
    const decoded = decodeURIComponent(file);

    if (decoded.includes("/") || decoded.includes("\\")) {
      return NextResponse.json({ error: "Invalid file" }, { status: 400 });
    }

    try {
      const stored = await query<{ bytes: Buffer; content_type: string }>(
        "select bytes, content_type from resume_files where file_name = $1 limit 1",
        [decoded]
      );
      if (stored.rowCount === 1) {
        return pdfResponse(stored.rows[0].bytes, decoded, stored.rows[0].content_type);
      }
    } catch {
      // Fall through to local filesystem fallback for development.
    }

    const target = path.join(resumeDir, decoded);
    const normalized = path.normalize(target);
    if (!normalized.startsWith(resumeDir)) {
      return NextResponse.json({ error: "Invalid file" }, { status: 400 });
    }

    try {
      const bytes = await readFile(normalized);
      return pdfResponse(bytes, decoded);
    } catch {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }
  } catch (error) {
    return jsonFromError(error, "Unable to load resume");
  }
}
