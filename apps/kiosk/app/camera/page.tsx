import { KioskLoader } from "@/components/kiosk-loader";
import type { BoothConfig } from "@/lib/contracts";
import { frameIdFromQuery, getPublicConfig } from "@/lib/public-config";

export default async function CameraPage({
  searchParams,
}: {
  searchParams: Promise<{ frame?: string | string[] }>;
}) {
  const config = getPublicConfig();
  const params = await searchParams;
  const requested = Array.isArray(params.frame) ? params.frame[0] : params.frame;
  const booth: BoothConfig = {
    wsUrl: config.wsUrl,
    cloudfrontDomain: config.cloudfrontDomain,
    eventId: config.eventId,
    frameId: frameIdFromQuery(config.frames, requested),
    bgId: config.backgrounds[0]?.id ?? "default",
  };

  return (
    <main>
      <KioskLoader config={booth} />
    </main>
  );
}
