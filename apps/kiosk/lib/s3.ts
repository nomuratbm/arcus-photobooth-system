import "server-only";

import {
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { finalImageUrl, type PrintPhoto } from "@/lib/contracts";

let client: S3Client | undefined;
let clientRegion: string | undefined;

export class PrintStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintStorageError";
  }
}

function getS3Client(region: string): S3Client {
  if (!client || clientRegion !== region) {
    client = new S3Client({ region });
    clientRegion = region;
  }
  return client;
}

export async function presignRawUpload(
  bucket: string,
  region: string,
  key: string,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: "image/jpeg",
  });

  return getSignedUrl(getS3Client(region), command, { expiresIn: 120 });
}

export async function listFinalPhotos(): Promise<PrintPhoto[]> {
  const bucket = process.env.BUCKET_NAME;
  const region = process.env.AWS_REGION;
  const domain = process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN?.trim();

  if (!bucket || !region || !domain) {
    throw new PrintStorageError("Print storage is not configured.");
  }

  const s3 = getS3Client(region);
  const ranked: { photoId: string; url: string; modified: number }[] = [];
  let token: string | undefined;

  try {
    do {
      const response = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: "final/",
          MaxKeys: 100,
          ContinuationToken: token,
        }),
      );

      for (const item of response.Contents ?? []) {
        const key = item.Key;
        if (!key?.startsWith("final/") || !key.endsWith(".jpg")) continue;
        ranked.push({
          photoId: key.slice("final/".length, -".jpg".length),
          url: finalImageUrl(domain, key),
          modified: item.LastModified?.getTime() ?? 0,
        });
      }

      token = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (token && ranked.length < 300);
  } catch {
    throw new PrintStorageError("Could not load photos from storage.");
  }

  return ranked
    .toSorted((a, b) => b.modified - a.modified)
    .map(({ photoId, url }) => ({ photoId, url }));
}
