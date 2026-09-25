import type { NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { prepareImport } from "@/lib/import/prepare";
import { IMPORT_MAX_BYTES } from "@/lib/import/types";
import { canAccessBranch } from "@/lib/permissions";

export const runtime = "nodejs";

// M24 upload: a route handler rather than a Server Action, whose body limit is 1 MB; a
// 20,000-row file is a few MB. Reads and checks the file and answers with the preview's
// id — nothing is imported until the user confirms.
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return Response.json({ ok: false, error: "errors.unauthenticated" }, { status: 401 });
  if (user.role === "SALESPERSON") return new Response(null, { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const branchId = String(form?.get("branchId") ?? "");
  if (!(file instanceof File) || file.size === 0)
    return Response.json({ ok: false, error: "import.errors.noFile" }, { status: 400 });
  if (file.size > IMPORT_MAX_BYTES)
    return Response.json({ ok: false, error: "import.errors.tooBig" }, { status: 400 });
  // A manager imports into their own branches only (SOW permission table).
  const branch = await db.branch.findFirst({
    where: { id: branchId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!branch || !canAccessBranch(user, branch.id))
    return Response.json({ ok: false, error: "import.errors.branch" }, { status: 400 });

  const result = await prepareImport({
    bytes: await file.arrayBuffer(),
    fileName: file.name,
    branchId: branch.id,
    uploaderId: user.id,
  });
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
