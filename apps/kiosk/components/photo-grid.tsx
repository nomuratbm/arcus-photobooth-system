import Image from "next/image";
import type { PrintPhoto } from "@/lib/contracts";

export function PhotoGrid({ photos }: { photos: PrintPhoto[] }) {
  if (photos.length === 0) {
    return <p className="text-lg">No finished photos yet.</p>;
  }

  return (
    <ul className="grid grid-cols-2 gap-4 md:grid-cols-3">
      {photos.map((photo) => (
        <li
          key={photo.photoId}
          className="print-card relative aspect-[3/4] overflow-hidden rounded-2xl bg-white"
        >
          <Image
            src={photo.url}
            alt={`Finished photo ${photo.photoId}`}
            fill
            unoptimized
            sizes="(min-width: 768px) 33vw, 50vw"
            className="object-cover"
          />
        </li>
      ))}
    </ul>
  );
}
