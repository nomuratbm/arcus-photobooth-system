import { KioskLoader } from "@/components/kiosk-loader";
import { getPublicConfig } from "@/lib/public-config";

export default function HomePage() {
  const config = getPublicConfig();

  return (
    <main>
      <KioskLoader config={config} />
    </main>
  );
}
