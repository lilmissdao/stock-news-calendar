import { get, put } from "@vercel/blob";
import { emptySync, isSyncCode, mergeSync, sanitizeSync, type SyncDoc } from "./sync";

function pathFor(code: string): string {
  return `sync/${code}.json`;
}

async function readDoc(code: string): Promise<{ doc: SyncDoc | null; etag: string | null }> {
  const result = await get(pathFor(code), { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return { doc: null, etag: null };
  const text = await new Response(result.stream).text();
  return { doc: sanitizeSync(JSON.parse(text)), etag: result.blob.etag };
}

export async function loadDoc(code: string): Promise<SyncDoc | null> {
  if (!isSyncCode(code)) throw new Error("bad code");
  const current = await readDoc(code);
  return current.doc;
}

export async function exchangeDoc(code: string, incoming: unknown): Promise<SyncDoc> {
  if (!isSyncCode(code)) throw new Error("bad code");
  const local = sanitizeSync(incoming);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readDoc(code);
    const merged = mergeSync(current.doc ?? emptySync(), local);
    try {
      await put(pathFor(code), JSON.stringify(merged), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 60,
        ...(current.etag ? { ifMatch: current.etag } : {}),
      });
      return merged;
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status) : 0;
      if (status !== 409 && status !== 412 && attempt === 3) throw error;
    }
  }
  const last = await readDoc(code);
  return mergeSync(last.doc ?? emptySync(), local);
}
