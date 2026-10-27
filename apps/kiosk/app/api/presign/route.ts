import { PHOTO_ID_RE, rawPhotoKey } from "@/lib/contracts";
import { presignRawUpload } from "@/lib/s3";

export async function POST(request: Request) {
  const bucket = process.env.BUCKET_NAME;
  const region = process.env.AWS_REGION;
  if (!bucket || !region) {
    return Response.json({ error: "Upload is not configured." }, { status: 503 });
  }

  let photoId = "";
  try {
    const body: unknown = await request.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "photoId" in body &&
      typeof body.photoId === "string"
    ) {
      photoId = body.photoId;
    }
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!PHOTO_ID_RE.test(photoId)) {
    return Response.json({ error: "Invalid photo id." }, { status: 400 });
  }

  const key = rawPhotoKey(photoId);

  try {
    const url = await presignRawUpload(bucket, region, key);
    return Response.json({ url });
  } catch {
    return Response.json({ error: "Could not prepare the upload." }, { status: 500 });
  }
}
