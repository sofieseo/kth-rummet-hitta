import {
  useState,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { optimizedImageUrl, optimizedImageSrcSet } from "@/lib/imageUrl";

function Placeholder({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative w-full h-full bg-muted-foreground/25 flex items-center justify-center",
        className,
      )}
      aria-hidden="true"
    >
      <Camera className="h-20 w-20 text-white" strokeWidth={1.5} />
    </div>
  );
}

export function ImageCarousel({
  images,
  alt,
  alts = [],
  className,
  onImageClick,
  priority = false,
}: {
  images: string[];
  alt: string;
  alts?: string[];
  className?: string;
  onImageClick?: (index: number) => void;
  priority?: boolean;
}) {
  const { t } = useTranslation();
  const helpId = useId();
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});
  const [galleryHasFocus, setGalleryHasFocus] = useState(false);
  const touchRef = useRef<{ x: number; y: number; moved: boolean; pointerType: string } | null>(
    null,
  );
  const swipedRef = useRef(false);
  const list = images.filter(Boolean);
  const count = list.length;
  const pointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    touchRef.current = { x: e.clientX, y: e.clientY, moved: false, pointerType: e.pointerType };
  };
  const pointerMove = (e: ReactPointerEvent) => {
    const s = touchRef.current;
    if (!s) return;
    if (Math.abs(e.clientX - s.x) > 8) s.moved = true;
  };
  const pointerUp = (e: ReactPointerEvent) => {
    const s = touchRef.current;
    touchRef.current = null;
    if (!s || count <= 1) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      e.stopPropagation();
      swipedRef.current = true;
      setIdx((i) => (i + (dx < 0 ? 1 : -1) + count) % count);
    } else if (s.moved) {
      swipedRef.current = true;
    }
  };

  // Preload neighboring images for snappier paging
  useEffect(() => {
    if (count <= 1) return;
    const neighbors = [(idx + 1) % count, (idx - 1 + count) % count];
    neighbors.forEach((i) => {
      if (loaded[i]) return;
      const img = new Image();
      img.src = optimizedImageUrl(list[i], 960);
      img.onload = () => setLoaded((prev) => (prev[i] ? prev : { ...prev, [i]: true }));
    });
  }, [idx, count, list, loaded]);

  if (count === 0) {
    return <Placeholder className={className} />;
  }

  const go = (delta: number) => {
    setIdx((i) => (i + delta + count) % count);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (count <= 1) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setIdx(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setIdx(count - 1);
    }
  };

  const isLoaded = !!loaded[idx];
  const currentAlt = alts[idx]?.trim() || alt;
  const image = (
    <img
      src={optimizedImageUrl(list[idx], 960)}
      srcSet={optimizedImageSrcSet(list[idx])}
      sizes="(min-width: 768px) 60vw, 100vw"
      alt={currentAlt}
      className="w-full h-full object-cover object-center"
      loading={priority ? "eager" : "lazy"}
      // @ts-expect-error -- fetchpriority is valid HTML, not yet in React types
      fetchpriority={priority ? "high" : "auto"}
      decoding="async"
      onLoad={() => setLoaded((prev) => ({ ...prev, [idx]: true }))}
    />
  );

  return (
    <div
      className={cn(
        "relative w-full h-full overflow-hidden bg-muted group touch-pan-y select-none",
        className,
      )}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={() => {
        touchRef.current = null;
      }}
    >
      {/* Subtle shimmer skeleton — no icon, so it doesn't flash a fake placeholder */}
      {!isLoaded && (
        <div className="absolute inset-0 z-0 animate-pulse bg-gradient-to-br from-muted via-muted/60 to-muted" />
      )}

      {onImageClick ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (swipedRef.current) {
              swipedRef.current = false;
              return;
            }
            onImageClick(idx);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setGalleryHasFocus(true)}
          onBlur={() => setGalleryHasFocus(false)}
          aria-label={t("gallery.control_label", {
            name: alt,
            current: idx + 1,
            count,
          })}
          aria-describedby={count > 1 ? helpId : undefined}
          aria-keyshortcuts={count > 1 ? "ArrowLeft ArrowRight Home End Enter" : "Enter"}
          className="relative z-[1] w-full h-full p-0 m-0 border-0 bg-transparent cursor-pointer focus-visible:outline-none"
        >
          {image}
        </button>
      ) : (
        <div className="relative z-[1] w-full h-full">{image}</div>
      )}

      {onImageClick && count > 1 && (
        <p id={helpId} className="sr-only">
          {t("gallery.control_hint")}
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {t("gallery.image_status", {
          current: idx + 1,
          count,
          description: currentAlt,
        })}
      </p>

      {/* All UI overlays appear only after the image is visible, so users never see
          chrome floating over an empty placeholder. */}
      {count > 1 && isLoaded && (
        <>
          {/* image counter intentionally removed */}

          <span
            aria-hidden="true"
            data-gallery-action="previous"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              go(-1);
            }}
            className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 z-20 h-8 w-8 cursor-pointer rounded-full bg-white/90 hover:bg-white text-[var(--kth-navy)] shadow-md items-center justify-center transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
          </span>
          <span
            aria-hidden="true"
            data-gallery-action="next"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              go(1);
            }}
            className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 z-20 h-8 w-8 cursor-pointer rounded-full bg-white/90 hover:bg-white text-[var(--kth-navy)] shadow-md items-center justify-center transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <ChevronRight className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
          </span>
        </>
      )}

      {/* The dots are the visible focus indicator for the composite gallery control.
          They remain pointer targets, while keyboard and assistive technology use
          the single image button above. A single-image gallery shows its dot only
          while focused so every Tab stop has a visible indicator. */}
      {isLoaded && (count > 1 || galleryHasFocus) && (
        <div
          aria-hidden="true"
          className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-black/55 backdrop-blur-sm shadow-md"
        >
          {list.map((_, i) => (
            <span
              key={i}
              data-gallery-index={i}
              data-gallery-focus={galleryHasFocus && i === idx ? "true" : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                setIdx(i);
              }}
              className="h-6 w-6 inline-flex cursor-pointer items-center justify-center rounded-full"
            >
              <span
                className={cn(
                  "block h-2 w-2 rounded-full transition-all",
                  i === idx ? "bg-white" : "bg-white/55 hover:bg-white/80",
                  galleryHasFocus &&
                    i === idx &&
                    "ring-2 ring-white ring-offset-2 ring-offset-black/55",
                )}
                aria-hidden="true"
              />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
