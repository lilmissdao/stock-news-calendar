import { exchangeDoc, loadDoc, syncFailureMessage } from "@/lib/sync-store";
import { isSyncCode, type SyncDoc } from "@/lib/sync";

export const runtime = "nodejs";

function unavailable() {
  return Response.json({ error: "Sync is not available yet." }, { status: 503 });
}

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) return unavailable();
  let body: { code?: unknown; doc?: unknown };
  try {
    body = (await request.json()) as { code?: unknown; doc?: unknown };
  } catch {
    return Response.json({ error: "The sync data was too big or was not valid." }, { status: 400 });
  }
  const code = typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
  if (!isSyncCode(code)) return Response.json({ error: "That sync code is not valid." }, { status: 400 });
  try {
    const doc = await exchangeDoc(code, body.doc);
    return Response.json(doc satisfies SyncDoc);
  } catch (error) {
    console.error("sync save failed", error instanceof Error ? error.message : error);
    return Response.json({ error: syncFailureMessage(error) }, { status: 502 });
  }
}

export async function GET(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) return unavailable();
  const code = new URL(request.url).searchParams.get("code")?.trim().toLowerCase() ?? "";
  if (!isSyncCode(code)) return Response.json({ error: "That sync code is not valid." }, { status: 400 });
  try {
    const doc = await loadDoc(code);
    if (!doc) return Response.json({ error: "No sync data for that code yet." }, { status: 404 });
    return Response.json(doc);
  } catch {
    return Response.json({ error: "Sync did not load." }, { status: 502 });
  }
}
