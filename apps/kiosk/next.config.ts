import type { NextConfig } from "next";

function imageHosts(): { protocol: "https"; hostname: string }[] {
  const patterns = [{ protocol: "https" as const, hostname: "*.cloudfront.net" }];
  const raw = process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN?.trim();
  if (!raw) return patterns;

  try {
    const hostname = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
    if (hostname && !hostname.endsWith(".cloudfront.net")) {
      patterns.push({ protocol: "https", hostname });
    }
  } catch {
    return patterns;
  }

  return patterns;
}

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
  ],
  images: {
    remotePatterns: imageHosts(),
  },
};

export default nextConfig;
