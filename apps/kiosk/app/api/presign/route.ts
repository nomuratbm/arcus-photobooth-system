import { PHOTO_ID_RE, SHOT_COUNT, rawShotKey } from "@/lib/contracts";
import { presignRawUpload } from "@/lib/s3";

export async function POST(request: Request) {
  const bucket = process.env.BUCKET_NAME;
  const region = process.env.AWS_REGION;
  if (!bucket || !region) {
    return Response.json({ error: "Upload is not configured." }, { status: 503 });
  }

  let sessionId = "";
  let index = 0;
  try {
    const body: unknown = await request.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "sessionId" in body &&
      typeof body.sessionId === "string" &&
      "index" in body &&
      typeof body.index === "number"
    ) {
      sessionId = body.sessionId;
      index = body.index;
    }
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!PHOTO_ID_RE.test(sessionId)) {
    return Response.json({ error: "Invalid session id." }, { status: 400 });
  }
  if (!Number.isInteger(index) || index < 1 || index > SHOT_COUNT) {
    return Response.json({ error: "Invalid shot index." }, { status: 400 });
  }

  const key = rawShotKey(sessionId, index);

  try {
    const url = await presignRawUpload(bucket, region, key);
    return Response.json({ url });
  } catch (error) {
    // Surface the real cause (usually an unresolvable AWS credential chain)
    // in the dev terminal instead of hiding behind a bare 500.
    console.error("[presign] failed to sign upload URL:", error);
    return Response.json({ error: "Could not prepare the upload." }, { status: 500 });
  }
}
