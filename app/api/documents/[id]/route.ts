import { NextResponse } from "next/server";
import { AtsError, requireApiContext } from "@/lib/ats/authz";
import { jsonFromError } from "@/lib/api-utils";
import { query } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireApiContext(request, "candidates:pii");
    const { id } = await params;
    const result = await query<{ bytes: Buffer; content_type: string; file_name: string }>(
      `select bytes, content_type, coalesce(original_file_name, file_name) as file_name
       from resume_files where id=$1 and organization_id=$2 and archived_at is null`,
      [id, context.organization.id]
    );
    const file = result.rows[0];
    if (!file) throw new AtsError("Document not found", 404, "NOT_FOUND");
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.content_type,
        "Content-Disposition": `inline; filename="${file.file_name.replace(/["\\]/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return jsonFromError(error, "Unable to read document");
  }
}
