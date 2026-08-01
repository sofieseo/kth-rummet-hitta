import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { sanitizeHtml, DESCRIPTION_SANITIZE_OPTIONS } from "@/lib/sanitizeHtml";
import {
  MapPin,
  Calendar,
  Info,
  Users,
  User,
  AlertTriangle,
  ChevronDown,
  Monitor,
  Armchair,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { TableChairIcon } from "./icons/TableChairIcon";

import { type Space } from "@/lib/spaces";
import { useFilterOptions } from "@/lib/useFilterOptions";
import { useCardLayout, type CardSectionKey } from "@/lib/useCardLayout";
import { useCapacityIcon } from "@/lib/useCapacityIcon";
import {
  useLiveSpaceStatus,
  type LiveOccupancy,
  type LiveGroupRoom,
} from "@/lib/useLiveSpaceStatus";

import { pickLocalized, type Lang } from "@/i18n";
import { OptionIcon } from "./OptionIcon";
import { ImageCarousel } from "./ImageCarousel";
import { ImageLightbox } from "./ImageLightbox";
import { OccupancyBadge } from "./OccupancyBadge";
import { GroupRoomBadge } from "./GroupRoomBadge";
import { cn } from "@/lib/utils";
import { useSpaceAnalytics } from "@/lib/useSpaceAnalytics";
import { type Filters } from "./FilterPanel";
import { parseSpaceLinks } from "@/lib/spaceLinks";
import { useRovingTabIndex } from "@/hooks/useRovingTabIndex";

type IntentValue = "enskilt" | "tillsammans" | "grupprum";
type CardActionKey = "book_now" | "button_map" | "button_group_booking" | "button_booking";

export function SpaceCard({
  space,
  layoutOverride,
  filters,
  onFiltersChange,
  priority = false,
  spaces,
  highlightId,
  highlightTick,
  onSpaceLink,
  previewOccupancy,
  previewGroupRoom,
}: {
  space: Space;
  /** Optional override for live preview in admin. */
  layoutOverride?: CardSectionKey[];
  filters?: Filters;
  onFiltersChange?: (next: Filters) => void;
  /** Eagerly load the image (use for above-the-fold cards). */
  priority?: boolean;
  spaces?: Space[];
  highlightId?: string;
  highlightTick?: number;
  onSpaceLink?: (id: string) => void;
  /** Force-show an occupancy badge in admin preview, bypassing real sensor data. */
  previewOccupancy?: LiveOccupancy;
  /** Force-show a group-room badge in admin preview. */
  previewGroupRoom?: LiveGroupRoom;
}) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.resolvedLanguage ?? "sv") as Lang;
  const [aboutOpen, setAboutOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [highlighted, setHighlighted] = useState(false);
  const headerRoving = useRovingTabIndex();
  const actionRoving = useRovingTabIndex();
  const { data: options = [] } = useFilterOptions();
  const {
    data: layoutFromDb = [
      "header",
      "notice",
      "info",
      "chips",
      "button_map",
      "button_group_booking",
      "button_booking",
    ],
  } = useCardLayout();
  const { data: capacityIconUrl, isPending: capacityIconPending } = useCapacityIcon();
  const { occupancy, groupRoom } = useLiveSpaceStatus(space, {
    occupancy: previewOccupancy,
    groupRoom: previewGroupRoom,
  });
  const layout = layoutOverride ?? layoutFromDb;

  useEffect(() => {
    if (highlightId && (highlightId === space.id || highlightId === space.slug)) {
      setHighlighted(true);
      const el = document.getElementById(`space-${space.id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      const timer = setTimeout(() => setHighlighted(false), 2500);
      return () => clearTimeout(timer);
    }
  }, [highlightId, highlightTick, space.id, space.slug]);

  const interactive = Boolean(filters && onFiltersChange);

  const lookup = new Map(options.map((o) => [`${o.category}:${o.label}`, o]));

  const images =
    space.images && space.images.length > 0
      ? space.images
      : space.image_url
        ? [space.image_url]
        : [];

  const localizedName = pickLocalized(space, "name", lang);
  const localizedDescription = pickLocalized(space, "description", lang);
  const localizedNotice = pickLocalized(space, "notice", lang);
  const localizedInfo = pickLocalized(space, "info", lang);
  const localizedFloor = pickLocalized(space, "floor", lang);
  const localizedLocatedIn = pickLocalized(space, "located_in", lang);
  const localizedGroupBookingUrl =
    pickLocalized(space, "group_booking_url", lang) || space.group_booking_url || "";
  const groupBookingLabel =
    pickLocalized(space, "group_booking_label", lang).trim() ||
    (space.group_booking_label ?? "").trim() ||
    t("card.button_group_booking");
  const localizedMapUrl = pickLocalized(space, "map_url", lang) || space.map_url || "";
  const localizedBookingUrl = pickLocalized(space, "booking_url", lang) || space.booking_url || "";

  const bookNowUrl = useMemo(() => {
    const template =
      lang === "en" && space.book_now_url_en?.trim()
        ? space.book_now_url_en
        : (space.book_now_url ?? "");
    if (!template) return "";
    if (template.includes("{room}") && space.booking_room_number == null) return "";
    const now = new Date();
    return template
      .replaceAll(
        "{room}",
        space.booking_room_number != null ? String(space.booking_room_number) : "",
      )
      .replaceAll("{year}", String(now.getFullYear()))
      .replaceAll("{month}", String(now.getMonth() + 1))
      .replaceAll("{day}", String(now.getDate()))
      .replaceAll("{hour}", String(now.getHours()))
      .replaceAll("{minute}", "0");
  }, [lang, space.book_now_url, space.book_now_url_en, space.booking_room_number]);

  const localizedAlts = useMemo(() => {
    const sv = space.image_alts ?? [];
    const en = space.image_alts_en ?? [];
    if (lang !== "en") return sv;
    return sv.map((s, i) => {
      const e = en[i];
      return e && e.trim().length > 0 ? e : s;
    });
  }, [lang, space.image_alts, space.image_alts_en]);

  const analytics = useSpaceAnalytics(space);

  const handleSpaceLink = useCallback(
    (id: string) => {
      analytics.trackSpaceLink(id);
      onSpaceLink?.(id);
    },
    [analytics, onSpaceLink],
  );

  const linkedNotice = useMemo(() => {
    if (!localizedNotice || !spaces || !onSpaceLink) return localizedNotice;
    return parseSpaceLinks(localizedNotice, spaces, lang, handleSpaceLink, { allowHtml: true });
  }, [localizedNotice, spaces, onSpaceLink, lang, handleSpaceLink]);

  const linkedInfo = useMemo(() => {
    if (!localizedInfo || !spaces || !onSpaceLink) return localizedInfo;
    return parseSpaceLinks(localizedInfo, spaces, lang, handleSpaceLink, { allowHtml: true });
  }, [localizedInfo, spaces, onSpaceLink, lang, handleSpaceLink]);

  const sanitizedDescription = useMemo(
    () =>
      localizedDescription ? sanitizeHtml(localizedDescription, DESCRIPTION_SANITIZE_OPTIONS) : "",
    [localizedDescription],
  );

  const localizeChip = (category: string, value: string): string => {
    const opt = lookup.get(`${category}:${value}`);
    return opt ? pickLocalized(opt, "label", lang) : value;
  };

  const isGrupprum =
    (space.lokaltyp ?? []).includes("Grupprum") || (space.intent ?? []).includes("grupprum");

  // Intent chips on the card: enskilt / tillsammans for regular spaces,
  // "I grupprum" for group-room spaces. Noise level always joins this row.
  const intentChips: { value: IntentValue; label: string }[] = isGrupprum
    ? [{ value: "grupprum", label: t("filters.intent_grupprum") }]
    : (space.intent ?? [])
        .filter((v): v is IntentValue => v === "enskilt" || v === "tillsammans")
        .map((v) => ({
          value: v,
          label: v === "enskilt" ? t("filters.intent_enskilt") : t("filters.intent_tillsammans"),
        }));

  type CategoryChip = { category: string; value: string; key: string; label: string };
  const categoryChips: CategoryChip[] = [
    ...(space.noise ?? []).map((n) => ({
      category: "noise",
      value: n,
      key: `noise:${n}`,
      label: localizeChip("noise", n),
    })),
    ...space.equipment.map((e) => ({
      category: "equipment",
      value: e,
      key: `equipment:${e}`,
      label: localizeChip("equipment", e),
    })),
    ...space.facilities.map((f) => ({
      category: "facility",
      value: f,
      key: `facility:${f}`,
      label: localizeChip("facility", f),
    })),
    ...Object.entries(space.tags ?? {}).flatMap(([cat, values]) =>
      cat === "vaningsplan"
        ? []
        : (Array.isArray(values) ? values : []).map((v) => ({
            category: cat,
            value: v,
            key: `${cat}:${v}`,
            label: localizeChip(cat, v),
          })),
    ),
  ];

  const noiseChips = categoryChips.filter((c) => c.category === "noise");
  const otherCategoryChips = categoryChips.filter((c) => c.category !== "noise");
  const visibleNoiseChips = noiseChips.filter((c) => lookup.has(c.key));
  const visibleOtherCategoryChips = otherCategoryChips.filter((c) => lookup.has(c.key));

  const isIntentSelected = (v: IntentValue) => filters?.workMode === v;
  const isCategorySelected = (cat: string, v: string) =>
    (filters?.byCategory?.[cat] ?? []).includes(v);

  const toggleIntent = (v: IntentValue) => {
    if (!filters || !onFiltersChange) return;
    const next = filters.workMode === v ? null : v;
    onFiltersChange({
      ...filters,
      workMode: next,
      groupSize: null,
    });
  };

  const toggleCategory = (cat: string, v: string) => {
    if (!filters || !onFiltersChange) return;
    const current = filters.byCategory[cat] ?? [];
    const nextArr = current.includes(v) ? current.filter((x) => x !== v) : [...current, v];
    onFiltersChange({
      ...filters,
      byCategory: { ...filters.byCategory, [cat]: nextArr },
    });
  };

  const floorPart = localizedFloor;
  const locatedInPart = localizedLocatedIn;
  const lokaltypParts = (space.lokaltyp ?? [])
    .filter((l) => l !== "Grupprum" && l !== "Resursrum")
    .map((l) => localizeChip("lokaltyp", l))
    .filter((s): s is string => Boolean(s && s.length > 0));

  const floorRowParts = [floorPart, locatedInPart].filter((s): s is string =>
    Boolean(s && s.length > 0),
  );

  const hasMeta = floorRowParts.length > 0 || lokaltypParts.length > 0;

  const showCapacity = (space.capacity ?? 0) > 0;

  const chipBase =
    "inline-flex items-center gap-1.5 text-xs rounded-full px-2 py-1 max-w-full transition-all duration-150 active:scale-95";
  const chipUnselected = "text-muted-foreground bg-secondary/60 hover:bg-accent";
  const chipSelected =
    "bg-[var(--kth-blue)] text-white hover:bg-[var(--kth-blue)]/90 [&_img]:brightness-0 [&_img]:invert";

  const hasCollapsibleDescription = Boolean(sanitizedDescription && !space.description_inline);
  const descriptionIsVisible = Boolean(
    sanitizedDescription && (space.description_inline || aboutOpen),
  );
  const chipControlCount = interactive
    ? intentChips.length + visibleNoiseChips.length + visibleOtherCategoryChips.length
    : 0;
  const chipStartIndex = hasCollapsibleDescription ? 1 : 0;
  const headerControlCount = chipStartIndex + chipControlCount;
  const headerHelpId = `space-${space.id}-header-controls-help`;

  const headerRovingProps = (index: number) => ({
    ref: (node: HTMLButtonElement | null) => {
      headerRoving.register(index, node);
    },
    tabIndex: headerRoving.tabIndex(index),
    onFocus: () => headerRoving.onFocus(index),
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) =>
      headerRoving.onKeyDown(event, index, headerControlCount),
  });

  const renderIntentChip = (chip: { value: IntentValue; label: string }, index: number) => {
    const selected = isIntentSelected(chip.value);
    const Icon = chip.value === "enskilt" ? User : Users;
    const content = (
      <>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="break-words">{chip.label}</span>
      </>
    );

    return interactive ? (
      <button
        key={`intent:${chip.value}`}
        type="button"
        {...headerRovingProps(index)}
        onClick={(event) => {
          event.stopPropagation();
          toggleIntent(chip.value);
        }}
        aria-pressed={selected}
        className={cn(chipBase, selected ? chipSelected : chipUnselected)}
        title={selected ? t("chips.remove_aria", { label: chip.label }) : chip.label}
      >
        {content}
      </button>
    ) : (
      <span key={`intent:${chip.value}`} className={cn(chipBase, chipUnselected)}>
        {content}
      </span>
    );
  };

  const renderCategoryChip = (chip: CategoryChip, index: number) => {
    const option = lookup.get(chip.key);
    if (!option) return null;
    const selected = isCategorySelected(chip.category, chip.value);
    const content = (
      <>
        <OptionIcon option={option} className="h-3.5 w-3.5 shrink-0" />
        <span className="break-words">{chip.label}</span>
      </>
    );

    return interactive ? (
      <button
        key={chip.key}
        type="button"
        {...headerRovingProps(index)}
        onClick={(event) => {
          event.stopPropagation();
          toggleCategory(chip.category, chip.value);
        }}
        aria-pressed={selected}
        className={cn(chipBase, selected ? chipSelected : chipUnselected)}
        title={selected ? t("chips.remove_aria", { label: chip.label }) : chip.label}
      >
        {content}
      </button>
    ) : (
      <span key={chip.key} title={chip.label} className={cn(chipBase, chipUnselected)}>
        {content}
      </span>
    );
  };

  const renderChipRows = () => {
    if (
      intentChips.length === 0 &&
      visibleNoiseChips.length === 0 &&
      visibleOtherCategoryChips.length === 0
    ) {
      return null;
    }

    const topRow = [
      ...intentChips.map((chip, index) => renderIntentChip(chip, chipStartIndex + index)),
      ...visibleNoiseChips.map((chip, index) =>
        renderCategoryChip(chip, chipStartIndex + intentChips.length + index),
      ),
    ].filter(Boolean);
    const bottomStartIndex = chipStartIndex + intentChips.length + visibleNoiseChips.length;
    const bottomRow = visibleOtherCategoryChips
      .map((chip, index) => renderCategoryChip(chip, bottomStartIndex + index))
      .filter(Boolean);

    return (
      <div className="mt-2 flex flex-col gap-1.5">
        {topRow.length > 0 && <div className="flex flex-wrap items-center gap-1.5">{topRow}</div>}
        {bottomRow.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">{bottomRow}</div>
        )}
      </div>
    );
  };

  const renderSection = (key: CardSectionKey) => {
    switch (key) {
      case "header":
        return (
          <div
            key="header"
            role={headerControlCount > 1 ? "toolbar" : undefined}
            aria-label={
              headerControlCount > 1
                ? t("card.header_filters_label", { name: localizedName })
                : undefined
            }
            aria-describedby={headerControlCount > 1 ? headerHelpId : undefined}
            onBlurCapture={headerRoving.onBlurCapture}
            className="flex flex-col gap-4 md:gap-5"
          >
            {headerControlCount > 1 && (
              <p id={headerHelpId} className="sr-only">
                {t("card.roving_group_help")}
              </p>
            )}
            <div className="flex flex-col gap-1">
              <h3
                id={`space-${space.id}-title`}
                className="text-lg md:text-xl font-semibold leading-none"
              >
                {hasCollapsibleDescription ? (
                  <button
                    type="button"
                    {...headerRovingProps(0)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setAboutOpen((v) => {
                        if (!v) analytics.trackExpand();
                        return !v;
                      });
                    }}
                    aria-expanded={aboutOpen}
                    aria-controls={`space-${space.id}-about`}
                    title={aboutOpen ? t("card.hide_description") : t("card.about_button")}
                    className="group/title inline-flex max-w-full items-baseline gap-1.5 rounded-md text-left text-inherit hover:text-[var(--kth-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
                  >
                    <span>{localizedName}</span>
                    <span
                      className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1 group-hover/title:bg-accent"
                      aria-hidden="true"
                    >
                      <Info className="h-4 w-4" />
                      <ChevronDown
                        className={cn("h-4 w-4 transition-transform", aboutOpen && "rotate-180")}
                      />
                    </span>
                  </button>
                ) : (
                  localizedName
                )}
              </h3>
              {hasMeta && (
                <div className="mt-1 text-sm text-muted-foreground leading-snug">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {floorPart && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-flex w-4 justify-center">
                          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        </span>
                        <span>{floorPart}</span>
                      </span>
                    )}
                    {floorPart && locatedInPart && (
                      <span className="text-muted-foreground/50" aria-hidden="true">
                        |
                      </span>
                    )}
                    {locatedInPart && <span>{locatedInPart}</span>}
                    {(floorPart || locatedInPart) && lokaltypParts.length > 0 && (
                      <span className="text-muted-foreground/50" aria-hidden="true">
                        |
                      </span>
                    )}
                    {lokaltypParts.length > 0 && <span>{lokaltypParts.join(" • ")}</span>}
                  </div>
                </div>
              )}
              {(showCapacity ||
                (space.informal_seat_count ?? 0) > 0 ||
                (space.computer_count ?? 0) > 0) && (
                <div className="mt-1.5 flex flex-wrap items-end gap-x-4 gap-y-1 text-sm text-foreground">
                  {showCapacity && (
                    <p className="inline-flex items-end gap-1.5">
                      <span className="inline-flex w-4 justify-center">
                        {capacityIconUrl ? (
                          <img src={capacityIconUrl} alt="" className="h-4 w-4 object-contain" />
                        ) : capacityIconPending ? (
                          <span className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <TableChairIcon
                            className="h-4 w-4 text-foreground/70"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      <span className="leading-none">
                        <span className="sr-only">{t("card.study_seats_sr")} </span>
                        <span className="font-medium">{space.capacity}</span>{" "}
                        {t("card.study_seats_label", { count: space.capacity ?? 0 })}
                      </span>
                    </p>
                  )}
                  {(space.informal_seat_count ?? 0) > 0 && (
                    <p className="inline-flex items-end gap-1.5">
                      <span className="inline-flex w-4 justify-center">
                        <Armchair className="h-4 w-4 text-foreground/70" aria-hidden="true" />
                      </span>
                      <span className="leading-none">
                        <span className="sr-only">{t("card.informal_seats_sr")} </span>
                        <span className="font-medium">{space.informal_seat_count}</span>{" "}
                        {t("card.informal_seats_label", { count: space.informal_seat_count ?? 0 })}
                      </span>
                    </p>
                  )}
                  {(space.computer_count ?? 0) > 0 && (
                    <p className="inline-flex items-end gap-1.5">
                      <span className="inline-flex w-4 justify-center">
                        <Monitor className="h-4 w-4 text-foreground/70" aria-hidden="true" />
                      </span>
                      <span className="leading-none">
                        <span className="sr-only">{t("card.computers_sr")} </span>
                        <span className="font-medium">{space.computer_count}</span>{" "}
                        {t("card.computers_label", { count: space.computer_count ?? 0 })}
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>

            {(occupancy || groupRoom) && (
              <div className="flex flex-col gap-2">
                {occupancy && <OccupancyBadge level={occupancy.level} status={occupancy.status} />}
                {groupRoom && <GroupRoomBadge status={groupRoom.status} />}
              </div>
            )}
            {renderChipRows()}
          </div>
        );
      case "notice":
        if (!linkedNotice) return null;
        return (
          <div
            key="notice"
            role="status"
            className="flex items-start gap-1.5 bg-[hsl(48_100%_85%)] text-foreground rounded-lg px-3 py-2 text-sm"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-orange-500" aria-hidden="true" />
            <span className="whitespace-pre-line">
              <span className="sr-only">{t("card.notice_sr")} </span>
              {linkedNotice}
            </span>
          </div>
        );
      case "info":
        if (!linkedInfo) return null;
        return (
          <div key="info" className="flex items-start gap-1.5 text-sm text-foreground/80">
            <Info
              className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="whitespace-pre-line">{linkedInfo}</span>
          </div>
        );
      case "chips": {
        // Chips are rendered with the heading so they form one composite group.
        return null;
      }

      case "button_map":
      case "button_group_booking":
      case "button_booking":
        return null;
    }
  };

  const buttonClass =
    "inline-flex items-center gap-1.5 rounded-full bg-[var(--kth-blue)] text-white px-4 py-1.5 text-xs font-semibold hover:bg-[var(--kth-blue)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary transition-colors";

  const availableActionKeys: CardActionKey[] = [
    ...(groupRoom?.status === "free" && bookNowUrl ? (["book_now"] as const) : []),
    ...layout
      .filter(
        (key): key is Exclude<CardActionKey, "book_now"> =>
          key === "button_map" || key === "button_group_booking" || key === "button_booking",
      )
      .filter((key) => {
        if (key === "button_map") return Boolean(localizedMapUrl);
        if (key === "button_group_booking") return Boolean(localizedGroupBookingUrl);
        return Boolean(localizedBookingUrl);
      }),
  ];
  const actionHelpId = `space-${space.id}-actions-help`;

  const actionRovingProps = (index: number) => ({
    ref: (node: HTMLAnchorElement | null) => {
      actionRoving.register(index, node);
    },
    tabIndex: actionRoving.tabIndex(index),
    onFocus: () => actionRoving.onFocus(index),
    onKeyDown: (event: ReactKeyboardEvent<HTMLAnchorElement>) =>
      actionRoving.onKeyDown(event, index, availableActionKeys.length),
  });

  const renderButton = (key: CardActionKey, index: number) => {
    switch (key) {
      case "book_now":
        return (
          <a
            key="book_now"
            {...actionRovingProps(index)}
            href={bookNowUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              event.stopPropagation();
              analytics.trackBooking("group_booking");
            }}
            className={buttonClass}
          >
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t("card.book_now")}</span>
            <span className="sr-only">{t("card.opens_new_tab_sr")}</span>
          </a>
        );
      case "button_map":
        return (
          <a
            key="button_map"
            {...actionRovingProps(index)}
            href={localizedMapUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              analytics.trackMap();
            }}
            className={buttonClass}
          >
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t("card.button_map")}</span>
            <span className="sr-only">{t("card.opens_new_tab_sr")}</span>
          </a>
        );
      case "button_group_booking":
        return (
          <a
            key="button_group_booking"
            {...actionRovingProps(index)}
            href={localizedGroupBookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              analytics.trackBooking("group_booking");
            }}
            className={buttonClass}
          >
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{groupBookingLabel}</span>
            <span className="sr-only">{t("card.opens_new_tab_sr")}</span>
          </a>
        );
      case "button_booking":
        return (
          <a
            key="button_booking"
            {...actionRovingProps(index)}
            href={localizedBookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              analytics.trackBooking("booking");
            }}
            className={buttonClass}
          >
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t("card.button_booking")}</span>
            <span className="sr-only">{t("card.opens_new_tab_sr")}</span>
          </a>
        );
    }
  };
  const renderedButtons = availableActionKeys.map(renderButton);

  return (
    <article
      id={`space-${space.id}`}
      aria-labelledby={`space-${space.id}-title`}
      className={cn(
        "bg-card rounded-2xl card-shadow hover:card-shadow-hover overflow-hidden transition-all duration-200",
        highlighted && "space-highlight",
      )}
    >
      <div className="flex flex-col md:grid md:grid-cols-[2fr_3fr] md:grid-rows-[1fr_auto] items-stretch gap-0">
        <div
          className={cn(
            "order-2 min-w-0 flex flex-col gap-4 p-3 md:order-none md:col-start-1 md:row-start-1 md:gap-5 md:p-6",
            renderedButtons.length > 0 && "pb-0 md:pb-6",
          )}
        >
          {layout.map((k) => renderSection(k))}

          {sanitizedDescription && (
            <div
              id={`space-${space.id}-about`}
              hidden={!descriptionIsVisible}
              className={cn(
                "text-sm text-foreground/90 leading-relaxed space-y-2 [&_a]:text-[var(--kth-blue)] [&_a]:underline [&_a:hover]:opacity-80 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 whitespace-pre-line",
                !space.description_inline && "border-t border-border pt-4",
              )}
              dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
            />
          )}
        </div>

        <div
          data-card-media
          className="order-1 w-full shrink-0 self-start aspect-[3/2] overflow-hidden rounded-t-2xl md:order-none md:col-start-2 md:row-start-1 md:row-span-2 md:rounded-t-none md:rounded-l-none md:rounded-tr-2xl"
        >
          <ImageCarousel
            images={images}
            alts={localizedAlts}
            alt={localizedName}
            priority={priority}
            onImageClick={(index) => {
              setLightboxIndex(index);
              setLightboxOpen(true);
            }}
          />
        </div>

        {renderedButtons.length > 0 && (
          <div
            role={renderedButtons.length > 1 ? "toolbar" : undefined}
            aria-label={
              renderedButtons.length > 1
                ? t("card.actions_label", { name: localizedName })
                : undefined
            }
            aria-describedby={renderedButtons.length > 1 ? actionHelpId : undefined}
            onBlurCapture={actionRoving.onBlurCapture}
            className="order-3 flex flex-wrap items-center justify-end gap-2 px-3 pb-3 pt-4 md:order-none md:col-start-1 md:row-start-2 md:p-6 md:pt-0"
          >
            {renderedButtons.length > 1 && (
              <p id={actionHelpId} className="sr-only">
                {t("card.roving_group_help")}
              </p>
            )}
            {renderedButtons}
          </div>
        )}
      </div>

      <ImageLightbox
        images={images}
        alts={localizedAlts}
        initialIndex={lightboxIndex}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </article>
  );
}
