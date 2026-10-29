import { PHOTO_ID_RE, SHOT_COUNT, finalImageUrl } from "@/lib/contracts";
import { getRawPhotoBytes } from "@/lib/s3";

/**
 * Streams photo bytes through the kiosk origin. Final strips come from
 * CloudFront, which sends no CORS headers — so the print desk cannot fetch
 * them directly in the browser to re-encode as PNG. Raw shots are not on
 * CloudFront at all (the bucket policy keeps them private), so they are read
 * straight from S3. Either way nothing is exposed that the guest session did
 * not already produce.
 */
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const photoId = search.get("id") ?? "";
  const shotParam = search.get("shot");

  if (!PHOTO_ID_RE.test(photoId)) {
    return Response.json({ error: "Unknown photo." }, { status: 404 });
  }

  const imageHeaders = {
    "Content-Type": "image/jpeg",
    "Cache-Control": "private, max-age=300",
  };

  // Raw shot: raw/{sessionId}/{shot}.jpg via S3.
  if (shotParam !== null) {
    const shot = Number(shotParam);
    if (!Number.isInteger(shot) || shot < 1 || shot > SHOT_COUNT) {
      return Response.json({ error: "Unknown photo." }, { status: 404 });
    }
    const bytes = await getRawPhotoBytes(photoId, shot);
    if (!bytes) {
      return Response.json({ error: "Photo is not available." }, { status: 502 });
    }
    return new Response(bytes as unknown as BodyInit, { headers: imageHeaders });
  }

  // Final strip: final/{photoId}.jpg via CloudFront.
  const domain = process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN?.trim();
  if (!domain) {
    return Response.json({ error: "Unknown photo." }, { status: 404 });
  }

  try {
    const upstream = await fetch(finalImageUrl(domain, `final/${photoId}.jpg`), {
      cache: "no-store",
    });
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: "Photo is not available." }, { status: 502 });
    }
    return new Response(upstream.body, { headers: imageHeaders });
  } catch (error) {
    console.error(`[photo] failed to fetch final/${photoId}.jpg:`, error);
    return Response.json({ error: "Could not load the photo." }, { status: 502 });
  }
}
