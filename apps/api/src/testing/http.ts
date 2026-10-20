const boundary = "----bbmtestboundary";

/** Builds a multipart/form-data body for `app.inject`. */
export function multipartBody(
  fields: Record<string, string>,
  file?: { name: string; content: Buffer },
): { payload: Buffer; headers: Record<string, string> } {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: text/plain\r\n\r\n`,
      ),
      file.content,
      Buffer.from("\r\n"),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}
