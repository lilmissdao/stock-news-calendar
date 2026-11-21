import { get, put } from "@vercel/blob";
import { emptySync, isSyncCode, mergeSync, sanitizeSync, type SyncDoc } from "./sync";

function pathFor(code: string): string {
  return `sync/${code}.json`;
}

async function readDoc(code: string): Promise<SyncDoc | null> {
  try {
    const result = await get(pathFor(code), { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const text = await new Response(result.stream).text();
    return sanitizeSync(JSON.parse(text));
  } catch (error) {
    if (error instanceof Error && /does not exist|not found/i.test(error.message)) return null;
    throw error;
  }
}

export function syncFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/too large|payload/i.test(message)) return "The saved games are too big to sync.";
  if (/does not exist|store/i.test(message)) return "Sync storage is not connected.";
  if (/access denied|valid token/i.test(message)) return "Sync storage rejected the save.";
  if (/precondition|etag/i.test(message)) return "Sync hit a conflict. Try again.";
  return "Sync did not save. Try again.";
}

export async function loadDoc(code: string): Promise<SyncDoc | null> {
  if (!isSyncCode(code)) throw new Error("bad code");
  return readDoc(code);
}

export async function exchangeDoc(code: string, incoming: unknown): Promise<SyncDoc> {
  if (!isSyncCode(code)) throw new Error("bad code");
  const local = sanitizeSync(incoming);
  let merged = mergeSync((await readDoc(code)) ?? emptySync(), local);
  // ifMatch compares an ETag the private store does not accept, so every overwrite failed.
  await put(pathFor(code), JSON.stringify(merged), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
  const saved = await readDoc(code);
  if (saved) merged = mergeSync(saved, local);
  if (saved) {
    const again = JSON.stringify(mergeSync(saved, local));
    if (again !== JSON.stringify(saved)) {
      await put(pathFor(code), again, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 60,
      });
      return sanitizeSync(JSON.parse(again));
    }
  }
  return merged;
}
