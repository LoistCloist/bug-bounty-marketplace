import type { FastifyRequest } from "fastify";

export interface UploadedFile {
  filename: string;
  bytes: Buffer;
}

export type MultipartResult =
  | { ok: true; fields: Record<string, string>; file?: UploadedFile }
  | { ok: false; reason: "too_large" | "not_multipart" };

/** Reads every part of a multipart request: string fields, plus the part named
 * `file`. The size cap is the one @fastify/multipart was registered with. */
export async function readMultipart(request: FastifyRequest): Promise<MultipartResult> {
  const fields: Record<string, string> = {};
  let file: UploadedFile | undefined;
  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        const bytes = await part.toBuffer();
        if (part.fieldname === "file") file = { filename: part.filename, bytes };
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "FST_REQ_FILE_TOO_LARGE") return { ok: false, reason: "too_large" };
    if (code?.startsWith("FST_")) return { ok: false, reason: "not_multipart" };
    throw err;
  }
  return { ok: true, fields, file };
}
