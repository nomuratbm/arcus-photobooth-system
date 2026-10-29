import { KioskBooth } from "@/components/kiosk-booth";
import type { BoothConfig } from "@/lib/contracts";
import { cameraIdFromQuery, frameIdFromQuery, getPublicConfig } from "@/lib/public-config";

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CameraPage({
  searchParams,
}: {
  searchParams: Promise<{ frame?: string | string[]; camera?: string | string[] }>;
}) {
  const config = getPublicConfig();
  const params = await searchParams;
  const booth: BoothConfig = {
    wsUrl: config.wsUrl,
    cloudfrontDomain: config.cloudfrontDomain,
    eventId: config.eventId,
    frameId: frameIdFromQuery(config.frames, firstQueryValue(params.frame)),
    bgId: config.backgrounds[0]?.id ?? "default",
    cameraId: cameraIdFromQuery(firstQueryValue(params.camera)),
  };

  return (
    <main>
      <KioskBooth config={booth} />
    </main>
  );
}
