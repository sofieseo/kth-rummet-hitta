import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useEffect, useRef } from "react";
import { useStickyPanelViewport } from "@/lib/useStickyPanelViewport";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal, X, ArrowUpDown, SearchX, AlertTriangle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { type Space } from "@/lib/spaces";
import { useFilterCategories } from "@/lib/useFilterCategories";
import { FilterPanel, emptyFilters, type Filters } from "@/components/FilterPanel";
import { ActiveFilterChips } from "@/components/ActiveFilterChips";
import { SpaceCard } from "@/components/SpaceCard";
import { SpaceCardSkeleton } from "@/components/SpaceCardSkeleton";
import { SitePageLayout } from "@/components/SitePageLayout";
import { useUiText, formatSuggestTemplate } from "@/lib/useUiText";
import { matchesSpace, type MatchOptions } from "@/lib/filterMatch";
import { groupRoomLabels, isGroupRoomSpace } from "@/lib/groupRoom";
import { siteUrl } from "@/lib/siteUrl";


import { useNarrowestFilter } from "@/lib/useNarrowestFilter";
import { useFilterOptions } from "@/lib/useFilterOptions";
import { getGroupRoomAvailability } from "@/lib/groupRoomAvailability.functions";
import { useLiveActive } from "@/lib/useLiveActive";
import { track, usePageView, useDebouncedTrack } from "@/lib/analytics";
import {
  canonicalizeSearch,
  filtersToSearch,
  searchParamsEqual,
  searchToFilters,
  validateSearchInput,
  type SearchParams,
  type SortKey,
} from "@/lib/filterSearch";

import { Sheet, SheetContent, SheetTrigger, SheetClose, SheetTitle } from "@/components/ui/sheet";
import type { FilterCategoryRow } from "@/lib/spaces";

const spacesQueryOptions = queryOptions({
  queryKey: ["spaces"],
  queryFn: async (): Promise<Space[]> => {
    const { data, error } = await supabase.from("spaces").select("*").eq("hidden", false).order("sort_order").order("name");
    if (error) throw error;
    return data as unknown as Space[];
  },
  staleTime: 60_000,
});

export const Route = createFileRoute("/")({
  head: ({ match }) => {
    const lang = match.search.lang === "en" ? "en" : "sv";
    const isEn = lang === "en";
    const self = siteUrl(isEn ? "/?lang=en" : "/");
    const title = isEn
      ? "KTH Library Spacefinder"
      : "KTH Bibliotekets studieplatsväljare";
    const description = isEn
      ? "Explore the library's study spaces and filter your way to a favourite."
      : "Utforska bibliotekets studieplatser och filtrera fram din favorit.";
    const ogDescription = description;
    const ogImage = siteUrl("/og-preview.jpg?v=3");
    const imageAlt = isEn
      ? "Start page of KTH Library Spacefinder"
      : "Startsidan för KTH Bibliotekets studieplatsväljare";

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: ogDescription },
        { property: "og:type", content: "website" },
        { property: "og:locale", content: isEn ? "en_GB" : "sv_SE" },
        { property: "og:url", content: self },
        { property: "og:image", content: ogImage },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: imageAlt },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: ogDescription },
        { name: "twitter:image", content: ogImage },
      ],
      links: [
        // Self-referencing canonical per language: filter/share parameters
        // (highlight, q, cats …) never create duplicate pages in the index.
        { rel: "canonical", href: self },
        { rel: "alternate", hrefLang: "sv", href: siteUrl("/") },
        { rel: "alternate", hrefLang: "en", href: siteUrl("/?lang=en") },
        { rel: "alternate", hrefLang: "x-default", href: siteUrl("/") },
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "WebSite",
                "@id": `${siteUrl("/")}#website`,
                url: siteUrl("/"),
                name: title,
                description,
                inLanguage: isEn ? "en" : "sv",
                publisher: { "@id": `${siteUrl("/")}#library` },
              },
              {
                "@type": "Library",
                "@id": `${siteUrl("/")}#library`,
                name: isEn ? "KTH Library" : "KTH Biblioteket",
                url: isEn ? "https://www.kth.se/en/biblioteket" : "https://www.kth.se/biblioteket",
                parentOrganization: {
                  "@type": "CollegeOrUniversity",
                  name: isEn
                    ? "KTH Royal Institute of Technology"
                    : "Kungliga Tekniska högskolan",
                  url: "https://www.kth.se",
                },
                address: {
                  "@type": "PostalAddress",
                  streetAddress: "Osquars backe 31",
                  postalCode: "114 28",
                  addressLocality: "Stockholm",
                  addressCountry: "SE",
                },
              },
            ],
          }),
        },
      ],
    };
  },

  validateSearch: validateSearchInput,
  loader: ({ context }) => {
    // Prime the cache so the first paint has data available (no fetch waterfall
    // through useQuery). Fire-and-forget — the component keeps its own useQuery
    // for reactivity and per-request Suspense-free rendering.
    void context.queryClient.prefetchQuery(spacesQueryOptions);
  },
  component: SpaceFinderPage,
});

function SpaceFinderPage() {
  return (
    <SitePageLayout>
      <SpaceFinderApp />
    </SitePageLayout>
  );
}

function SpaceFinderApp() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.resolvedLanguage ?? "sv") as "sv" | "en";
  const routeSearch = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const {
    data: categories = [],
    isLoading: categoriesLoading,
    isError: categoriesError,
    isSuccess: categoriesReady,
  } = useFilterCategories();
  const {
    data: filterOptions = [],
    isLoading: filterOptionsLoading,
    isError: filterOptionsError,
    isSuccess: filterOptionsReady,
  } = useFilterOptions();
  const filterMetadataReady = categoriesReady && filterOptionsReady;
  const search = useMemo(
    () =>
      filterMetadataReady
        ? canonicalizeSearch(routeSearch, categories, filterOptions)
        : routeSearch,
    [filterMetadataReady, routeSearch, categories, filterOptions],
  );
  const filters = useMemo(() => searchToFilters(search, filterOptions), [search, filterOptions]);
  const filterPanelRef = useRef<HTMLDivElement | null>(null);
  const filterViewport = useStickyPanelViewport(filterPanelRef);

  useEffect(() => {
    if (!filterMetadataReady) return;
    if (searchParamsEqual(routeSearch, search)) return;
    navigate({
      search: search as never,
      replace: true,
      resetScroll: false,
    });
  }, [filterMetadataReady, routeSearch, search, navigate]);

  const sort: SortKey = search.sort ?? "recommended";
  // Live group-room data is only meaningful within opening hours.
  const liveActive = useLiveActive();
  const canSortFree = filters.workMode === "grupprum" && liveActive;
  const canSortSeats = filters.spaceKind === "study";
  // Auto-rank small group rooms first, but only until the user picks a sort
  // themselves — an explicit "Standard" must stay standard.
  const autoSeatsAsc =
    search.sort == null && filters.workMode === "grupprum" && filters.groupSize === "2-4";
  const effectiveSort: SortKey =
    sort === "free_now" && !canSortFree
      ? "recommended"
      : (sort === "seats_desc" || sort === "seats_asc") && !canSortSeats
        ? "recommended"
        : sort === "recommended" && autoSeatsAsc
          ? "seats_asc"
          : sort;



  // Keep the URL honest: a sort that can't apply in the current context
  // (seats outside study spaces, "free now" outside opening hours) is dropped
  // instead of lingering and silently switching back on later.
  useEffect(() => {
    const invalid =
      (search.sort === "free_now" && !canSortFree) ||
      ((search.sort === "seats_desc" || search.sort === "seats_asc") && !canSortSeats);
    if (invalid) {
      navigate({
        search: (prev: SearchParams) => ({ ...prev, sort: undefined }) as never,
        replace: true,
        resetScroll: false,
      });
    }
  }, [search.sort, canSortFree, canSortSeats, navigate]);

  const setFilters = (next: Filters) => {
    const nextSearch = filtersToSearch(next, undefined, filterOptions) as Record<string, unknown>;
    if (search.lang) nextSearch.lang = search.lang;
    const nextMode = next.workMode;
    if (search.sort && !(search.sort === "free_now" && nextMode !== "grupprum")) {
      nextSearch.sort = search.sort;
    }
    navigate({ search: nextSearch as never, replace: true, resetScroll: false });
  };

  const setSort = (next: SortKey) => {
    navigate({
      // "recommended" stays in the URL: it marks an explicit user choice and
      // switches off the automatic "fewest seats first" ranking.
      search: (prev: SearchParams) => ({ ...prev, sort: next }) as never,
      replace: true,
      resetScroll: false,
    });
  };



  const [highlightTick, setHighlightTick] = useState(0);
  // The card to scroll to and flash. Held in state (not in the URL) so a
  // shared link can be consumed once and then cleaned out of the address bar.
  const [highlightId, setHighlightId] = useState<string | undefined>(undefined);

  // A shared link (`/?highlight=<slug>`) lands in the default sort with no
  // filters, so the space is guaranteed to be in the list.
  const sharedHighlight = routeSearch.highlight;
  useEffect(() => {
    if (!sharedHighlight) return;
    track("share_open", {
      space_id: sharedHighlight,
      lang: typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("lang") ?? ""
        : "",
    });
    setHighlightId(sharedHighlight);
    setHighlightTick((t) => t + 1);
    navigate({ search: ((prev: SearchParams) => ({ lang: prev.lang })) as never, replace: true, resetScroll: false });
  }, [sharedHighlight, navigate]);

  const handleSpaceLink = (id: string) => {
    setHighlightId(id);
    setHighlightTick((t) => t + 1);
    const target = spaces.find((s) => s.id === id || s.slug === id);
    const visible = target ? filtered.some((s) => s.id === target.id) : false;
    if (target && !visible) {
      navigate({
        search: ((prev: SearchParams) => ({ lang: prev.lang })) as never,
        replace: true,
        resetScroll: false,
      });
    }
  };


  const {
    data: spaces = [],
    isLoading: spacesLoading,
    isError: spacesError,
    refetch,
  } = useQuery(spacesQueryOptions);
  const isLoading =
    spacesLoading || categoriesLoading || filterOptionsLoading;
  const isError = spacesError || categoriesError || filterOptionsError;
  const { data: emptyTitle } = useUiText("empty_title");
  const { data: emptySuggestTemplate } = useUiText("empty_suggest_template");
  const { data: emptyFallback } = useUiText("empty_fallback");

  const hasActiveFilter =
    filterMetadataReady &&
    (filters.query.trim().length > 0 ||
      filters.workMode !== null ||
      filters.groupSize !== null ||
      filters.freeOnly ||
      Object.values(filters.byCategory).some((arr) => arr.length > 0));

  const { data: availability } = useQuery({
    queryKey: ["group-room-availability"],
    queryFn: () => getGroupRoomAvailability(),
    refetchInterval: 60_000,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    // Enabled throughout opening hours: the same query key backs the card
    // badges, the mobile draft count and the "free right now" sort, so gating
    // it on the *applied* filters made the draft count read 0.
    enabled: liveActive,
  });

  const isFreeNow = useMemo(() => {
    const rooms = availability?.rooms ?? {};
    return (s: Space) => {
      const num = s.booking_room_number;
      if (num == null) return false;
      const r = rooms[String(num)];
      return Boolean(r && !r.disabled && r.status === "free");
    };
  }, [availability]);

  // English labels for room types so a search in English matches the Swedish
  // values stored on the space (e.g. "group room" -> "Grupprum").
  const extraSearchText = useMemo(() => {
    const enByLabel = new Map(
      filterOptions
        .filter((o) => o.category === "lokaltyp" && o.label_en)
        .map((o) => [o.label, o.label_en as string]),
    );
    return (s: Space) =>
      (s.lokaltyp ?? []).map((l) => enByLabel.get(l) ?? "").join(" ");
  }, [filterOptions]);

  // Group-room detection resolves through the options' stable value_key so a
  // renamed room-type label can't silently break filtering.
  const isGroupRoom = useMemo(() => {
    const labels = groupRoomLabels(filterOptions);
    return (s: Space) => isGroupRoomSpace(s, labels);
  }, [filterOptions]);

  const matchOptions = useMemo(
    () =>
      liveActive
        ? { isFree: isFreeNow, extraSearchText, isGroupRoom }
        : { extraSearchText, isGroupRoom },
    [liveActive, isFreeNow, extraSearchText, isGroupRoom],
  );


  const kindTotal = useMemo(
    () => spaces.filter((s) => (s.space_kind ?? "study") === filters.spaceKind).length,
    [spaces, filters.spaceKind],
  );

  const filtered = useMemo(() => {
    const kindMatched = spaces.filter((s) => (s.space_kind ?? "study") === filters.spaceKind);
    return kindMatched.filter((s) => matchesSpace(s, filters, categories, matchOptions));
  }, [spaces, filters, categories, matchOptions]);

  const sortedFiltered = useMemo(() => {
    const arr = [...filtered];
    // Space names are Swedish, so Swedish alphabetical order (Å, Ä, Ö at the
    // end) must apply even when the UI is in English.
    const collator = new Intl.Collator("sv", { sensitivity: "base", numeric: true });
    // Sort on the name the user actually sees.
    const displayName = (s: Space): string =>
      (lang === "en" ? (s.name_en ?? s.name) : s.name) ?? "";
    const floorNum = (s: Space): number => {
      const m = s.floor?.match(/-?\d+/);
      return m ? parseInt(m[0], 10) : Number.NaN;
    };
    // The cards show three seat types, so "number of seats" ranks on their sum.
    const seatTotal = (s: Space): number | null => {
      const parts = [s.capacity, s.informal_seat_count, s.computer_count];
      if (parts.every((p) => p == null)) return null;
      return parts.reduce<number>((sum, p) => sum + (p ?? 0), 0);
    };
    // Ties keep a predictable order: fall back to name A–Ö.
    const byName = (a: Space, b: Space) => collator.compare(displayName(a), displayName(b));
    if (effectiveSort === "seats_desc") {
      arr.sort((a, b) => ((seatTotal(b) ?? -1) - (seatTotal(a) ?? -1)) || byName(a, b));
    } else if (effectiveSort === "seats_asc") {
      arr.sort((a, b) => {
        const av = seatTotal(a) ?? Number.POSITIVE_INFINITY;
        const bv = seatTotal(b) ?? Number.POSITIVE_INFINITY;
        return (av - bv) || byName(a, b);
      });
    } else if (effectiveSort === "floor_asc" || effectiveSort === "floor_desc") {
      const dir = effectiveSort === "floor_asc" ? 1 : -1;
      arr.sort((a, b) => {
        const av = floorNum(a); const bv = floorNum(b);
        if (isNaN(av) && isNaN(bv)) return byName(a, b);
        if (isNaN(av)) return 1;
        if (isNaN(bv)) return -1;
        return ((av - bv) * dir) || byName(a, b);
      });
    } else if (effectiveSort === "name_asc") {
      arr.sort(byName);
    } else if (effectiveSort === "name_desc") {
      arr.sort((a, b) => collator.compare(displayName(b), displayName(a)));
    } else if (effectiveSort === "free_now" && canSortFree) {
      const rooms = availability?.rooms ?? {};
      const rank = (s: Space) => {
        const num = s.booking_room_number;
        if (num == null) return 3;
        const r = rooms[String(num)];
        if (!r || r.disabled) return 3;
        if (r.status === "free") return 0;
        if (r.status === "tentative") return 1;
        if (r.status === "busy") return 2;
        return 3;
      };
      arr.sort((a, b) => (rank(a) - rank(b)) || byName(a, b));
    }

    return arr;
  }, [filtered, effectiveSort, canSortFree, availability, lang]);

  const noFreeRoomsForSort = useMemo(() => {
    if (effectiveSort !== "free_now" || !canSortFree) return false;
    const rooms = availability?.rooms ?? {};
    return !sortedFiltered.some((s) => {
      const num = s.booking_room_number;
      if (num == null) return false;
      const r = rooms[String(num)];
      return r && !r.disabled && r.status === "free";
    });
  }, [effectiveSort, canSortFree, availability, sortedFiltered]);




  const noFreeRoomsEmpty =
    filters.workMode === "grupprum" && filters.freeOnly && liveActive && sortedFiltered.length === 0;

  const resultCountText =
    filters.spaceKind !== "study"
      ? t("results.count_hits", { count: sortedFiltered.length })
      : hasActiveFilter
        ? t("results.count_filtered", { filtered: sortedFiltered.length, total: kindTotal })
        : t("results.count_total", { count: sortedFiltered.length });


  const kindSpaces = useMemo(
    () => spaces.filter((s) => (s.space_kind ?? "study") === filters.spaceKind),
    [spaces, filters.spaceKind],
  );
  const narrowest = useNarrowestFilter(
    kindSpaces,
    filters,
    categories,
    filterOptions,
    matchOptions,
  );


  usePageView("home");

  useDebouncedTrack(
    "filter_change",
    filters,
    (f) => ({
      query: f.query.trim() || undefined,
      spaceKind: f.spaceKind ?? undefined,
      workMode: f.workMode ?? undefined,
      groupSize: f.groupSize ?? undefined,
      freeOnly: f.freeOnly || undefined,
      categories: Object.fromEntries(
        Object.entries(f.byCategory).filter(([, v]) => v.length > 0),
      ),
    }),
  );

  useEffect(() => {
    if (!isLoading && hasActiveFilter && filtered.length === 0) {
      track("empty_results", {
        query: filters.query.trim() || undefined,
        spaceKind: filters.spaceKind ?? undefined,
        workMode: filters.workMode ?? undefined,
        categories: Object.fromEntries(
          Object.entries(filters.byCategory).filter(([, v]) => v.length > 0),
        ),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, hasActiveFilter, filtered.length]);

  return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 lg:grid lg:grid-cols-[320px_1fr] lg:gap-6">
        <aside className="hidden lg:block lg:mt-11" aria-label={t("filters.title")}>
          <div
            ref={filterPanelRef}
            className="study-place-filter-panel bg-card rounded-xl card-shadow flex flex-col"
            style={filterViewport ? ({ ["--filter-panel-top" as string]: `${filterViewport.top}px`, ["--filter-panel-height" as string]: `${filterViewport.height}px` } as React.CSSProperties) : undefined}
          >

            <div className="flex items-center justify-between gap-2 px-3 min-h-9 shrink-0">
              <h2 className="inline-flex items-center gap-1.5 text-xs text-muted-foreground m-0 font-normal">
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                {t("filters.title")}
              </h2>
              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={() => setFilters(emptyFilters)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--kth-blue)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary rounded"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("filters.clear_all")}
                </button>
              )}
            </div>
            <div className="study-place-filter-content px-4 pb-4 pt-1">
              <FilterPanel filters={filters} onChange={setFilters} />
            </div>
          </div>

        </aside>


        <main id="main" tabIndex={-1} className="mobile-filter-main focus-visible:outline-none" aria-busy={isLoading}>
          <div className="mobile-filter-dock lg:hidden">
            <div className="mobile-filter-dock-inner">
              <MobileFilterSheet
                filters={filters}
                onApply={setFilters}
                spaces={spaces}
                categories={categories}
                matchOptions={matchOptions}
              />
            </div>
          </div>

          {/* One live region for both breakpoints: the visible counters are
              duplicated for layout, so they stay hidden from screen readers. */}
          <span className="sr-only" aria-live="polite" aria-atomic="true">
            {isLoading ? t("results.loading") : resultCountText}
          </span>

          <div className="flex flex-wrap items-center justify-between gap-3 mb-2 min-h-9">
            <span className="text-xs text-muted-foreground lg:hidden" aria-hidden="true">
              {isLoading ? t("results.loading") : resultCountText}
            </span>
            {!isLoading && (
              <div className="flex items-center gap-3 ml-auto">
                <span className="hidden lg:inline text-xs text-muted-foreground" aria-hidden="true">
                  {resultCountText}
                </span>

                <Select
                  value={effectiveSort === "recommended" ? "" : effectiveSort}
                  onValueChange={(v) => setSort((v || "recommended") as SortKey)}
                >
                  <SelectTrigger
                    id="sort-select"
                    aria-label={t("results.sort_label")}
                    className="h-auto min-h-9 w-auto gap-2 border-0 bg-transparent shadow-none rounded-lg px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent focus:ring-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 transition-colors [&>svg]:opacity-100"
                  >
                    <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="mr-0.5">{t("results.sort_label")}:</span>
                    <SelectValue placeholder={t("results.sort_placeholder")} />
                  </SelectTrigger>

                  <SelectContent align="end">
                    <SelectItem value="name_asc">{t("results.sort_name_asc")}</SelectItem>
                    <SelectItem value="name_desc">{t("results.sort_name_desc")}</SelectItem>
                    {filters.spaceKind === "study" && (
                      <SelectItem value="seats_desc">{t("results.sort_seats_desc")}</SelectItem>
                    )}
                    {filters.spaceKind === "study" && (
                      <SelectItem value="seats_asc">{t("results.sort_seats_asc")}</SelectItem>
                    )}
                    <SelectItem value="floor_asc">{t("results.sort_floor_asc")}</SelectItem>
                    <SelectItem value="floor_desc">{t("results.sort_floor_desc")}</SelectItem>
                    {canSortFree && (
                      <SelectItem value="free_now">{t("results.sort_free_now")}</SelectItem>
                    )}
                    {effectiveSort !== "recommended" && (
                      <SelectItem value="recommended">{t("results.sort_reset")}</SelectItem>
                    )}
                  </SelectContent>
                </Select>

              </div>
            )}
          </div>



          {filterMetadataReady && (
            <ActiveFilterChips filters={filters} onChange={setFilters} />
          )}

          {!isLoading && noFreeRoomsForSort && sortedFiltered.length > 0 && (
            <div
              role="status"
              className="rounded-2xl border border-border bg-[color:var(--kth-blue)]/5 px-4 py-3 text-sm text-foreground mb-4"
            >
              {t("results.no_free_rooms_notice")}
            </div>
          )}



          {isLoading && (
            <div className="space-y-4 md:space-y-6" role="status" aria-label={t("results.loading")}>
              {Array.from({ length: 3 }).map((_, i) => (
                <SpaceCardSkeleton key={i} />
              ))}
            </div>
          )}

          {!isLoading && isError && (
            <div
              role="alert"
              className="bg-card rounded-2xl card-shadow p-8 text-center flex flex-col items-center animate-fade-in"
            >
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="h-7 w-7" aria-hidden="true" />
              </div>
              <p className="text-lg font-semibold text-foreground mb-2">
                {t("results.error_title")}
              </p>
              <p className="text-sm text-muted-foreground mb-5 max-w-md">
                {t("results.error_body")}
              </p>
              <button
                type="button"
                onClick={() => { void refetch(); }}
                className="inline-flex items-center rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium shadow-sm transition-all hover:opacity-90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
              >
                {t("results.error_retry")}
              </button>
            </div>
          )}

          {!isLoading && !isError && sortedFiltered.length === 0 && (
            <div className="bg-card rounded-2xl card-shadow p-8 md:p-10 text-center flex flex-col items-center animate-fade-in">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--kth-blue)]/10 text-[color:var(--kth-blue)]">
                <SearchX className="h-7 w-7" aria-hidden="true" />
              </div>
              <p className="text-lg font-semibold text-foreground mb-2 whitespace-pre-line">
                {emptyTitle}
              </p>
              {noFreeRoomsEmpty ? (
                <>
                  <p className="text-sm text-muted-foreground mb-5 max-w-md whitespace-pre-line">
                    {t("results.no_free_rooms_empty")}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFilters({ ...filters, freeOnly: false })}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium shadow-sm transition-all hover:opacity-90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                      {t("results.remove_free_only")}
                    </button>
                  </div>
                </>
              ) : narrowest && narrowest.wouldMatch > 0 ? (
                <>
                  <p className="text-sm text-muted-foreground mb-5 max-w-md whitespace-pre-line">
                    {formatSuggestTemplate(emptySuggestTemplate ?? "", {
                      label: narrowest.label,
                      count: narrowest.wouldMatch,
                    }, lang)}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFilters(narrowest.remove(filters))}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium shadow-sm transition-all hover:opacity-90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                      {t("results.remove_filter", { label: narrowest.label })}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilters(emptyFilters)}
                      className="inline-flex items-center rounded-full border border-border bg-card text-foreground px-5 py-2.5 text-sm font-medium transition-all hover:bg-accent active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
                    >
                      {t("results.clear_all_filters")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground mb-5 max-w-md whitespace-pre-line">
                    {emptyFallback}
                  </p>
                  <button
                    type="button"
                    onClick={() => setFilters(emptyFilters)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium shadow-sm transition-all hover:opacity-90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
                  >
                    {t("results.clear_all_filters")}
                  </button>
                </>
              )}
            </div>
          )}

          {!isLoading && sortedFiltered.length > 0 && (
            <section aria-labelledby="results-heading">
              <h2 id="results-heading" className="sr-only">
                {t("results.heading")}
              </h2>
              <ul role="list" className="space-y-4 md:space-y-6 list-none pl-0">
                {sortedFiltered.map((s, i) => (
                  <li key={s.id}>
                    <SpaceCard space={s} filters={filters} onFiltersChange={setFilters} onSpaceLink={handleSpaceLink} highlightId={highlightId} highlightTick={highlightTick} spaces={spaces} priority={i < 2} />
                  </li>
                ))}
              </ul>
            </section>
          )}

        </main>
      </div>
  );
}

function MobileFilterSheet({
  filters,
  onApply,
  spaces,
  categories,
  matchOptions,
}: {
  filters: Filters;
  onApply: (f: Filters) => void;
  spaces: Space[];
  categories: FilterCategoryRow[];
  matchOptions: MatchOptions;

}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(filters);

  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  const draftCount = useMemo(() => {
    const cats = categories ?? [];
    const kindMatched = spaces.filter((s) => (s.space_kind ?? "study") === draft.spaceKind);
    return kindMatched.filter((s) => matchesSpace(s, draft, cats, matchOptions)).length;
  }, [spaces, draft, categories, matchOptions]);


  const apply = () => {
    onApply(draft);
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold shadow-lg shadow-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary transition-transform active:scale-95">
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> {t("filters.open")}
        </button>

      </SheetTrigger>
      <SheetContent side="bottom" hideClose className="mobile-filter-sheet p-0 flex flex-col overflow-hidden gap-0 rounded-t-2xl border-t">
        <SheetTitle className="sr-only">{t("filters.title")}</SheetTitle>
        <div className="shrink-0 px-4 pt-4 pb-2 flex items-center justify-between">
          <SheetClose
            aria-label={t("filters.close")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </SheetClose>
          <button
            type="button"
            onClick={() => setDraft(emptyFilters)}
            className="px-4 py-2 text-sm font-medium text-foreground hover:bg-accent rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
          >
            {t("filters.clear")}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">
          <div className="px-6 pb-6 pt-2">
            <FilterPanel filters={draft} onChange={setDraft} />
          </div>
          <div className="sticky bottom-0 mt-auto border-t border-border bg-card p-4">
            <button
              type="button"
              onClick={apply}
              className="w-full rounded-full bg-primary text-primary-foreground px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
            >
              {t("filters.show_results_count", { count: draftCount })}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
