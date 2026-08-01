import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholder that mirrors the SpaceCard layout so the page
 * doesn't shift when real data arrives. Purely decorative — hidden
 * from assistive tech via aria-hidden on the container.
 */
export function SpaceCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="bg-card rounded-2xl result-card-shadow overflow-hidden animate-fade-in"
    >
      <div className="flex flex-col md:grid md:grid-cols-[2fr_3fr] items-stretch gap-0">
        <div className="order-2 md:order-1 min-w-0 flex flex-col gap-4 md:gap-5 p-3 md:p-6">
          {/* Title + metadata */}
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-7 w-3/4" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-4 w-1/3" />
          </div>

          {/* Seat counts row */}
          <div className="flex flex-wrap gap-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-28" />
          </div>

          {/* Filter chips – row 1 */}
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-8 w-20 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-16 rounded-full" />
          </div>
          {/* Filter chips – row 2 */}
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-8 w-28 rounded-full" />
            <Skeleton className="h-8 w-20 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-full" />
          </div>

          <div className="mt-auto flex flex-wrap justify-end gap-2 pt-4">
            <Skeleton className="h-9 w-28 rounded-full" />
            <Skeleton className="h-9 w-32 rounded-full" />
          </div>
        </div>
        <div className="order-1 md:order-2 w-full shrink-0 self-start aspect-[3/2]">
          <Skeleton className="h-full w-full rounded-none" />
        </div>
      </div>
    </div>
  );
}
