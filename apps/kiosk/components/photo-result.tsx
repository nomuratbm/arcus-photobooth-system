import Image from "next/image";

export function PhotoResult({
  url,
  onNewPhoto,
}: {
  url: string;
  onNewPhoto: () => void;
}) {
  return (
    <div className="absolute inset-0">
      <Image
        src={url}
        alt="Finished photobooth photo"
        fill
        unoptimized
        sizes="(min-width: 1024px) 70vw, 100vw"
        className="object-cover"
      />
      <button
        type="button"
        onClick={onNewPhoto}
        className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-paper px-5 py-2 font-medium text-ink"
      >
        New photo
      </button>
    </div>
  );
}

export function BoothNotice({
  message,
  action,
  onAction,
}: {
  message: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/75 px-8 text-center">
      <p className="max-w-sm text-lg">{message}</p>
      <button
        type="button"
        onClick={onAction}
        className="rounded-full bg-paper px-5 py-2 font-medium text-ink"
      >
        {action}
      </button>
    </div>
  );
}
