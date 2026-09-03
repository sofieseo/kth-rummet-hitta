import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Download, Info } from "lucide-react";
import { sv } from "date-fns/locale";
import { format, parseISO } from "date-fns";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import { exportAnalyticsToExcel } from "@/lib/analyticsExport";
import { matchesSpace } from "@/lib/filterMatch";
import { groupRoomLabels, isGroupRoomSpace } from "@/lib/groupRoom";
import { emptyFilters, type Filters } from "@/components/FilterPanel";
import type { FilterCategoryRow, FilterOption, Space } from "@/lib/spaces";



type Row = {
  id: number;
  event_type: string;
  payload: Record<string, unknown> | null;
  session_id: string | null;
  path: string | null;
  created_at: string;
};

type DemandSupplyItem = {
  categoryKey: string;
  categoryLabel: string;
  valueKey: string;
  valueLabel: string;
  demand: number;
  supply: number;
};

type EmptyComboWithSuggestion = {
  filters: string;
  count: number;
  suggestion: string;
};

type TrendRow = {
  date: string;
  total: number;
  empty: number;
  [seriesKey: string]: number | string;
};

const PRESETS = [

  { key: "24h", label: "24 timmar", hours: 24 },
  { key: "7d", label: "7 dagar", hours: 24 * 7 },
  { key: "30d", label: "30 dagar", hours: 24 * 30 },
  { key: "90d", label: "90 dagar", hours: 24 * 90 },
  { key: "365d", label: "12 månader", hours: 24 * 365 },
  { key: "custom", label: "Anpassad", hours: 0 },
] as const;
type PresetKey = (typeof PRESETS)[number]["key"];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

const KIND_LABELS: Record<string, string> = {
  study: "Studieplats",
  creative: "Skapande och paus",
  service: "Service och faciliteter",
};

const TREND_COLORS = [
  "var(--primary)",
  "var(--chart-2, #10b981)",
  "var(--chart-3, #f59e0b)",
  "var(--chart-4, #ef4444)",
  "var(--chart-5, #8b5cf6)",
];

function valueLabelFor(categoryKey: string, value: string, filterOptions: FilterOption[]): string {
  if (categoryKey === "spaceKind") return KIND_LABELS[value] ?? value;
  if (categoryKey === "freeOnly") return "Endast lediga grupprum";
  const opt = filterOptions.find((o) => o.category === categoryKey && o.label === value);
  return opt?.label ?? value;
}

function categoryLabelFor(key: string, categories: FilterCategoryRow[]): string {
  if (key === "spaceKind") return "Kategori";
  if (key === "workMode") return "Läge";
  if (key === "groupSize") return "Grupprumsstorlek";
  if (key === "freeOnly") return "Endast lediga";
  return categories.find((c) => c.key === key)?.title ?? key;
}

function buildFiltersFromPayload(p: Record<string, unknown>): Filters {
  const cats = (p.categories ?? {}) as Record<string, string[]>;
  return {
    query: String(p.query ?? ""),
    spaceKind: String(p.spaceKind ?? "study") as Space["space_kind"],
    workMode: p.workMode ? String(p.workMode) : null,
    groupSize:
      p.groupSize === "2-4" || p.groupSize === "5+"
        ? (p.groupSize as "2-4" | "5+")
        : null,
    freeOnly: Boolean(p.freeOnly),
    byCategory: { ...cats },
  };
}

function countMatchingSpaces(
  test: Filters,
  spaces: Space[],
  categories: FilterCategoryRow[],
  isGroupRoom: (s: Space) => boolean,
): number {
  return spaces.filter((s) => matchesSpace(s, test, categories, { isGroupRoom })).length;
}

export function AnalyticsTab({
  spaces,
  categories,
  filterOptions,
}: {
  spaces: Space[];
  categories: FilterCategoryRow[];
  filterOptions: FilterOption[];
}) {

  const [preset, setPreset] = useState<PresetKey>("7d");
  const [heatmapMode, setHeatmapMode] = useState<"total" | "avg">("total");
  const [customFrom, setCustomFrom] = useState<Date | undefined>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return startOfDay(d);
  });
  const [customTo, setCustomTo] = useState<Date | undefined>(() => endOfDay(new Date()));

  const { from, to } = useMemo(() => {
    if (preset === "custom") {
      const f = customFrom ? startOfDay(customFrom) : startOfDay(new Date());
      const t = customTo ? endOfDay(customTo) : endOfDay(new Date());
      return { from: f, to: t };
    }
    const p = PRESETS.find((x) => x.key === preset)!;
    return { from: new Date(Date.now() - p.hours * 3600 * 1000), to: new Date() };
  }, [preset, customFrom, customTo]);

  const periodValid = from <= to && (to.getTime() - from.getTime()) <= 365 * 24 * 3600 * 1000;

  const prevRange = useMemo(() => {
    const span = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - span);
    return { prevFrom, prevTo };
  }, [from, to]);

  const { data, isLoading } = useQuery({
    queryKey: ["analytics_events", from.toISOString(), to.toISOString()],
    queryFn: async (): Promise<{ current: Row[]; previous: Row[] }> => {
      const [cur, prev] = await Promise.all([
        supabase
          .from("analytics_events")
          .select("id,event_type,payload,session_id,path,created_at")
          .gte("created_at", from.toISOString())
          .lte("created_at", to.toISOString())
          .order("created_at", { ascending: false })
          .limit(50000),
        supabase
          .from("analytics_events")
          .select("id,event_type,payload,session_id,path,created_at")
          .gte("created_at", prevRange.prevFrom.toISOString())
          .lte("created_at", prevRange.prevTo.toISOString())
          .order("created_at", { ascending: false })
          .limit(50000),
      ]);
      if (cur.error) throw cur.error;
      if (prev.error) throw prev.error;
      return {
        current: (cur.data ?? []) as unknown as Row[],
        previous: (prev.data ?? []) as unknown as Row[],
      };
    },
    enabled: periodValid,
    refetchInterval: 30_000,
  });

  const rows = data?.current ?? [];
  const prevRows = data?.previous ?? [];


  const computeTotals = (src: Row[]) => {
    const byType: Record<string, number> = {};
    const sessions = new Set<string>();
    const sessionsExpanded = new Set<string>();
    const sessionsBooked = new Set<string>();
    for (const r of src) {
      byType[r.event_type] = (byType[r.event_type] ?? 0) + 1;
      if (r.session_id) sessions.add(r.session_id);
      if (r.event_type === "card_expand" && r.session_id) sessionsExpanded.add(r.session_id);
      if (r.event_type === "booking_link_click" && r.session_id) sessionsBooked.add(r.session_id);
    }
    return {
      byType,
      total: src.length,
      sessions: sessions.size,
      expandRate: sessions.size ? sessionsExpanded.size / sessions.size : 0,
      bookRate: sessions.size ? sessionsBooked.size / sessions.size : 0,
    };
  };
  const totals = useMemo(() => computeTotals(rows), [rows]);
  const prevTotals = useMemo(() => computeTotals(prevRows), [prevRows]);


  const topCards = useMemo(() => {
    const counts: Record<
      string,
      { name: string; count: number; expand: number; booking: number; map: number }
    > = {};
    for (const r of rows) {
      if (!["card_expand", "booking_link_click", "map_link_click"].includes(r.event_type)) continue;
      const id = String((r.payload as { space_id?: string } | null)?.space_id ?? "");
      if (!id) continue;
      const name = String((r.payload as { name?: string } | null)?.name ?? id);
      const e = counts[id] ?? { name, count: 0, expand: 0, booking: 0, map: 0 };
      e.name = name;
      e.count++;
      if (r.event_type === "card_expand") e.expand++;
      else if (r.event_type === "booking_link_click") e.booking++;
      else if (r.event_type === "map_link_click") e.map++;
      counts[id] = e;
    }
    return Object.entries(counts).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [rows]);

  const kindBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (r.event_type !== "filter_change") continue;
      const k = String((r.payload as { spaceKind?: string } | null)?.spaceKind ?? "");
      if (!k) continue;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return Object.entries(counts)
      .map(([k, v]) => ({ key: k, label: KIND_LABELS[k] ?? k, count: v, pct: total ? v / total : 0 }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  const bookingKinds = useMemo(() => {
    const labels: Record<string, string> = {
      book_now: "”Boka nu” (ledigt grupprum)",
      group_booking: "”Boka grupprum”",
      booking: "”Se schema”",
      okänd: "Okänd knapp",
    };
    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (r.event_type !== "booking_link_click") continue;
      const k = String((r.payload as { kind?: string } | null)?.kind ?? "okänd");
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([k, v]) => ({ label: labels[k] ?? k, count: v }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  const topFilterCombos = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (r.event_type !== "filter_change") continue;
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const parts: string[] = [];
      if (p.spaceKind) parts.push(`kategori: ${KIND_LABELS[String(p.spaceKind)] ?? String(p.spaceKind)}`);
      if (p.query) parts.push("sökord");
      if (p.workMode) parts.push(`läge: ${String(p.workMode)}`);
      if (p.groupSize) parts.push(`storlek: ${String(p.groupSize)}`);
      if (p.freeOnly) parts.push("endast lediga grupprum");
      const cats = (p.categories ?? {}) as Record<string, string[]>;
      for (const [k, v] of Object.entries(cats)) {
        for (const val of (v ?? []).slice().sort()) parts.push(`${k}: ${val}`);
      }
      if (!parts.length) continue;
      const key = parts.sort().join(" · ");
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [rows]);

  const topFilters = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (r.event_type !== "filter_change") continue;
      const p = (r.payload ?? {}) as Record<string, unknown>;
      if (p.query) counts["sökord"] = (counts["sökord"] ?? 0) + 1;
      if (p.workMode) counts[`läge: ${String(p.workMode)}`] = (counts[`läge: ${String(p.workMode)}`] ?? 0) + 1;
      if (p.groupSize) counts[`storlek: ${String(p.groupSize)}`] = (counts[`storlek: ${String(p.groupSize)}`] ?? 0) + 1;
      if (p.freeOnly) counts["endast lediga grupprum"] = (counts["endast lediga grupprum"] ?? 0) + 1;
      const cats = (p.categories ?? {}) as Record<string, string[]>;
      for (const [cat, vals] of Object.entries(cats)) {
        for (const v of vals ?? []) counts[`${cat}: ${v}`] = (counts[`${cat}: ${v}`] ?? 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  }, [rows]);

  const topQueries = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (r.event_type !== "filter_change") continue;
      const q = String((r.payload as { query?: string } | null)?.query ?? "").trim().toLowerCase();
      if (q) counts[q] = (counts[q] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [rows]);

  const trafficByHour = useMemo(() => {
    const counts = new Array<number>(24).fill(0);
    for (const r of rows) {
      if (r.event_type !== "page_view") continue;
      counts[new Date(r.created_at).getHours()]++;
    }
    return counts.map((v, h) => ({ label: `${String(h).padStart(2, "0")}`, value: v }));
  }, [rows]);

  const trafficByWeekday = useMemo(() => {
    const names = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];
    const counts = new Array<number>(7).fill(0);
    for (const r of rows) {
      if (r.event_type !== "page_view") continue;
      counts[new Date(r.created_at).getDay()]++;
    }
    // reorder Mon-Sun
    const ordered = [1, 2, 3, 4, 5, 6, 0].map((i) => ({ label: names[i], value: counts[i] }));
    return ordered;
  }, [rows]);

  const emptySearches = useMemo(() => {
    const out: { when: string; query?: string; kind?: string; workMode?: string; cats: string }[] = [];
    for (const r of rows) {
      if (r.event_type !== "empty_results") continue;
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const cats = Object.entries((p.categories ?? {}) as Record<string, string[]>)
        .map(([k, v]) => `${k}: ${(v ?? []).join(", ")}`)
        .join(" · ");
      out.push({
        when: new Date(r.created_at).toLocaleString("sv-SE"),
        query: p.query ? String(p.query) : undefined,
        kind: p.spaceKind ? (KIND_LABELS[String(p.spaceKind)] ?? String(p.spaceKind)) : undefined,
        workMode: p.workMode ? String(p.workMode) : undefined,
        cats,
      });
      if (out.length >= 30) break;
    }
    return out;
  }, [rows]);

  const emptyCombos = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (r.event_type !== "empty_results") continue;
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const parts: string[] = [];
      if (p.workMode) parts.push(`läge: ${String(p.workMode)}`);
      if (p.freeOnly) parts.push("endast lediga");
      const cats = (p.categories ?? {}) as Record<string, string[]>;
      for (const [k, v] of Object.entries(cats)) {
        for (const val of (v ?? []).slice().sort()) parts.push(`${k}: ${val}`);
      }
      const key = parts.length ? parts.sort().join(" · ") : "(inga filter)";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [rows]);

  const deviceBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (r.event_type !== "page_view") continue;
      const d = String((r.payload as { device?: string } | null)?.device ?? "okänd");
      counts[d] = (counts[d] ?? 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const labels: Record<string, string> = { mobile: "Mobil", desktop: "Desktop", tablet: "Surfplatta", okänd: "Okänd" };
    return Object.entries(counts)
      .map(([k, v]) => ({ key: k, label: labels[k] ?? k, count: v, pct: total ? v / total : 0 }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  const sourceBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (r.event_type !== "page_view") continue;
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const utm = p.utm_source ? `utm: ${String(p.utm_source)}` : null;
      const ref = p.referrer ? String(p.referrer) : null;
      const key = utm ?? ref ?? "direkt";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [rows]);

  const shareStats = useMemo(() => {
    const byMethod: Record<string, number> = {};
    const byLang: Record<string, number> = {};
    const bySpace: Record<string, { name: string; count: number }> = {};
    const openBySpace: Record<string, number> = {};
    let clicks = 0;
    let opens = 0;
    for (const r of rows) {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const id = String(p.space_id ?? "");
      if (r.event_type === "share_click") {
        clicks++;
        const method = String(p.method ?? "okänd");
        byMethod[method] = (byMethod[method] ?? 0) + 1;
        const lang = String(p.lang ?? "okänd");
        byLang[lang] = (byLang[lang] ?? 0) + 1;
        if (id) {
          bySpace[id] = { name: String(p.name ?? id), count: (bySpace[id]?.count ?? 0) + 1 };
        }
      } else if (r.event_type === "share_open") {
        opens++;
        if (id) openBySpace[id] = (openBySpace[id] ?? 0) + 1;
      }
    }
    const methodLabels: Record<string, string> = {
      native: "Delningsmeny (mobil)",
      clipboard: "Kopierad länk",
      prompt: "Manuell kopiering",
      okänd: "Okänd",
    };
    const langLabels: Record<string, string> = { sv: "Svenska", en: "Engelska", "": "Okänt", okänd: "Okänt" };
    const top = Object.entries(bySpace)
      .map(([id, v]) => ({ id, name: v.name, count: v.count, opens: openBySpace[id] ?? 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    return {
      clicks,
      opens,
      methods: Object.entries(byMethod)
        .map(([k, v]) => ({ label: methodLabels[k] ?? k, count: v }))
        .sort((a, b) => b.count - a.count),
      langs: Object.entries(byLang)
        .map(([k, v]) => ({ label: langLabels[k] ?? k, count: v }))
        .sort((a, b) => b.count - a.count),
      top,
    };
  }, [rows]);

  const isGroupRoom = useMemo(() => {
    const labels = groupRoomLabels(filterOptions);
    return (s: Space) => isGroupRoomSpace(s, labels);
  }, [filterOptions]);

  const demandSupply = useMemo<DemandSupplyItem[]>(() => {
    const demand = new Map<string, number>();
    const add = (categoryKey: string, value: string) => {
      if (!value) return;
      const key = `${categoryKey}\x00${value}`;
      demand.set(key, (demand.get(key) ?? 0) + 1);
    };
    for (const r of rows) {
      if (r.event_type !== "filter_change") continue;
      const p = (r.payload ?? {}) as Record<string, unknown>;
      if (p.spaceKind) add("spaceKind", String(p.spaceKind));
      if (p.workMode) add("workMode", String(p.workMode));
      if (p.groupSize) add("groupSize", String(p.groupSize));
      if (p.freeOnly) add("freeOnly", "lediga");
      const cats = (p.categories ?? {}) as Record<string, string[]>;
      for (const [cat, vals] of Object.entries(cats)) {
        for (const v of vals ?? []) add(cat, v);
      }
    }

    const items: DemandSupplyItem[] = [];
    for (const [key, demandCount] of demand.entries()) {
      const [categoryKey, valueKey] = key.split("\x00");
      let supply = 0;
      if (categoryKey === "spaceKind") {
        supply = spaces.filter((s) => s.space_kind === valueKey).length;
      } else if (categoryKey === "workMode") {
        supply = countMatchingSpaces(
          { ...emptyFilters, workMode: valueKey as Filters["workMode"] },
          spaces,
          categories,
          isGroupRoom,
        );
      } else if (categoryKey === "groupSize") {
        supply = countMatchingSpaces(
          { ...emptyFilters, workMode: "grupprum", groupSize: valueKey as Filters["groupSize"] },
          spaces,
          categories,
          isGroupRoom,
        );
      } else if (categoryKey !== "freeOnly") {
        supply = countMatchingSpaces(
          { ...emptyFilters, byCategory: { [categoryKey]: [valueKey] } },
          spaces,
          categories,
          isGroupRoom,
        );
      }
      items.push({
        categoryKey,
        categoryLabel: categoryLabelFor(categoryKey, categories),
        valueKey,
        valueLabel: valueLabelFor(categoryKey, valueKey, filterOptions),
        demand: demandCount,
        supply,
      });
    }
    return items.sort((a, b) => b.demand - a.demand);
  }, [rows, spaces, categories, filterOptions, isGroupRoom]);

  const demandSupplyByCategory = useMemo(() => {
    const map: Record<string, DemandSupplyItem[]> = {};
    for (const item of demandSupply) {
      (map[item.categoryLabel] ??= []).push(item);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => b.demand - a.demand);
    }
    return map;
  }, [demandSupply]);

  /** Efterfrågan vs utbud för hela filterkombinationer (inte enskilda filter). */
  const comboDemandSupply = useMemo<DemandSupplyItem[]>(() => {
    const combos = new Map<string, { label: string; filters: Filters; count: number }>();
    for (const r of rows) {
      if (r.event_type !== "filter_change") continue;
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const filters = buildFiltersFromPayload(p);
      const parts: string[] = [];
      if (filters.query) parts.push(`Sökord: ”${filters.query}”`);
      if (p.spaceKind) parts.push(`${categoryLabelFor("spaceKind", categories)}: ${valueLabelFor("spaceKind", String(p.spaceKind), filterOptions)}`);
      if (filters.workMode) parts.push(`${categoryLabelFor("workMode", categories)}: ${filters.workMode}`);
      if (filters.groupSize) parts.push(`${categoryLabelFor("groupSize", categories)}: ${filters.groupSize}`);
      if (filters.freeOnly) parts.push("Endast lediga grupprum");
      for (const [cat, vals] of Object.entries(filters.byCategory)) {
        for (const v of (vals ?? []).slice().sort()) {
          parts.push(`${categoryLabelFor(cat, categories)}: ${valueLabelFor(cat, v, filterOptions)}`);
        }
      }
      // Endast riktiga kombinationer (minst två aktiva filter)
      if (parts.length < 2) continue;
      const label = parts.join(" · ");
      const existing = combos.get(label);
      if (existing) existing.count++;
      else combos.set(label, { label, filters, count: 1 });
    }
    return Array.from(combos.values())
      .map((c) => ({
        categoryKey: "combo",
        categoryLabel: "Filterkombination",
        valueKey: c.label,
        valueLabel: c.label,
        demand: c.count,
        supply: countMatchingSpaces(c.filters, spaces, categories, isGroupRoom),
      }))
      .sort((a, b) => b.demand - a.demand)
      .slice(0, 12);
  }, [rows, spaces, categories, filterOptions, isGroupRoom]);


  const emptyResultsWithSuggestions = useMemo<EmptyComboWithSuggestion[]>(() => {
    const combos = new Map<
      string,
      { filters: Filters; displayParts: string[]; count: number }
    >();
    for (const r of rows) {
      if (r.event_type !== "empty_results") continue;
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const filters = buildFiltersFromPayload(p);
      const parts: string[] = [];
      if (filters.query) parts.push(`sökord: ${filters.query}`);
      if (p.spaceKind) parts.push(`kategori: ${KIND_LABELS[String(p.spaceKind)] ?? String(p.spaceKind)}`);
      if (filters.workMode) parts.push(`läge: ${filters.workMode}`);
      if (filters.groupSize) parts.push(`storlek: ${filters.groupSize}`);
      if (filters.freeOnly) parts.push("endast lediga grupprum");
      for (const [cat, vals] of Object.entries(filters.byCategory)) {
        const catLabel = categoryLabelFor(cat, categories);
        for (const v of vals) parts.push(`${catLabel}: ${valueLabelFor(cat, v, filterOptions)}`);
      }
      const key = parts.sort().join(" · ");
      const existing = combos.get(key);
      if (existing) {
        existing.count++;
      } else {
        combos.set(key, { filters, displayParts: parts, count: 1 });
      }
    }

    const out: EmptyComboWithSuggestion[] = [];
    for (const { filters, displayParts, count } of combos.values()) {
      const candidates: { label: string; test: Filters }[] = [];
      if (filters.query) candidates.push({ label: "sökord", test: { ...filters, query: "" } });
      if (filters.workMode) candidates.push({ label: "läge", test: { ...filters, workMode: null } });
      if (filters.groupSize) candidates.push({ label: "grupprumsstorlek", test: { ...filters, groupSize: null } });
      if (filters.freeOnly) candidates.push({ label: "endast lediga", test: { ...filters, freeOnly: false } });
      for (const [cat, vals] of Object.entries(filters.byCategory)) {
        const catLabel = categoryLabelFor(cat, categories);
        for (const v of vals) {
          const nextVals = vals.filter((x) => x !== v);
          const nextByCat = { ...filters.byCategory, [cat]: nextVals };
          let nextFilters: Filters;
          if (nextVals.length === 0) {
            const { [cat]: _, ...rest } = nextByCat;
            nextFilters = { ...filters, byCategory: rest };
          } else {
            nextFilters = { ...filters, byCategory: nextByCat };
          }
          candidates.push({
            label: `${catLabel}: ${valueLabelFor(cat, v, filterOptions)}`,
            test: nextFilters,
          });
        }
      }

      let best: { label: string; count: number } | null = null;
      for (const c of candidates) {
        const n = countMatchingSpaces(c.test, spaces, categories, isGroupRoom);
        if (n > 0 && (!best || n > best.count)) best = { label: c.label, count: n };
      }
      const suggestion = best
        ? `Om du tar bort ${best.label} visas ${best.count} ${best.count === 1 ? "lokal" : "lokaler"}`
        : "Inget enstaka filter kan tas bort för att ge träffar";
      out.push({ filters: displayParts.join(" · "), count, suggestion });
    }
    return out.sort((a, b) => b.count - a.count).slice(0, 10);
  }, [rows, spaces, categories, filterOptions, isGroupRoom]);

  const trendData = useMemo(() => {
    const topValues = demandSupply.slice(0, 5);
    const seriesKeys = topValues.map((v) => `${v.categoryKey}:${v.valueKey}`);
    const seriesLabels = topValues.map((v) => `${v.categoryLabel}: ${v.valueLabel}`);
    const buckets = new Map<string, { total: number; empty: number; values: Record<string, number> }>();
    const ensure = (day: string) => {
      if (!buckets.has(day)) buckets.set(day, { total: 0, empty: 0, values: {} });
      return buckets.get(day)!;
    };
    for (const r of rows) {
      const day = r.created_at.slice(0, 10);
      if (r.event_type === "empty_results") {
        ensure(day).empty++;
        continue;
      }
      if (r.event_type !== "filter_change") continue;
      const bucket = ensure(day);
      bucket.total++;
      const p = (r.payload ?? {}) as Record<string, unknown>;
      for (let i = 0; i < topValues.length; i++) {
        const item = topValues[i];
        let hit = false;
        if (item.categoryKey === "spaceKind" && String(p.spaceKind ?? "") === item.valueKey) hit = true;
        else if (item.categoryKey === "workMode" && String(p.workMode ?? "") === item.valueKey) hit = true;
        else if (item.categoryKey === "groupSize" && String(p.groupSize ?? "") === item.valueKey) hit = true;
        else if (item.categoryKey === "freeOnly" && p.freeOnly) hit = true;
        else {
          const cats = (p.categories ?? {}) as Record<string, string[]>;
          if ((cats[item.categoryKey] ?? []).includes(item.valueKey)) hit = true;
        }
        if (hit) bucket.values[seriesKeys[i]] = (bucket.values[seriesKeys[i]] ?? 0) + 1;
      }
    }

    const points: TrendRow[] = [];
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(0, 0, 0, 0);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const bucket = buckets.get(iso) ?? { total: 0, empty: 0, values: {} };
      const point: TrendRow = { date: iso, total: bucket.total, empty: bucket.empty };
      for (let i = 0; i < seriesKeys.length; i++) {
        point[seriesKeys[i]] = bucket.values[seriesKeys[i]] ?? 0;
      }
      points.push(point);
    }
    return { points, series: seriesKeys.map((k, i) => ({ key: k, label: seriesLabels[i] })) };
  }, [rows, demandSupply, from, to]);

  const heatmap = useMemo(() => {
    // 7 rows (Mon-Sun) x 24 cols
    const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const r of rows) {
      if (r.event_type !== "page_view") continue;
      const d = new Date(r.created_at);
      const dow = (d.getDay() + 6) % 7; // Mon=0
      grid[dow][d.getHours()]++;
    }
    const weeks = Math.max(1, (to.getTime() - from.getTime()) / (7 * 24 * 3600 * 1000));
    const averaged = grid.map((row) => row.map((v) => v / weeks));
    let max = 0;
    for (const row of grid) for (const v of row) if (v > max) max = v;
    return { grid, averaged, weeks, max, maxAvg: max / weeks };
  }, [rows, from, to]);




  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold">Statistik</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-full border border-border bg-card overflow-hidden text-sm">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPreset(p.key)}
                className={`px-3 py-1.5 ${preset === p.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rows.length === 0}
            onClick={() =>
              exportAnalyticsToExcel(rows, from, to, {
                demandSupply,
                emptyWithAlternatives: emptyResultsWithSuggestions,
                trend: trendData,
              })
            }
          >
            <Download className="h-4 w-4 mr-2" /> Exportera Excel
          </Button>
        </div>
      </div>

      {preset === "custom" && (
        <div className="flex items-end gap-3 flex-wrap rounded-xl border border-border bg-card p-4">
          <DatePicker label="Från" value={customFrom} onChange={setCustomFrom} />
          <DatePicker label="Till" value={customTo} onChange={setCustomTo} />
          {!periodValid && (
            <p className="text-sm text-destructive">
              Ogiltig period (max 365 dagar, från ≤ till).
            </p>
          )}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Vald period: {format(from, "d MMM yyyy HH:mm", { locale: sv })} – {format(to, "d MMM yyyy HH:mm", { locale: sv })}
      </p>
      <p className="text-xs text-muted-foreground -mt-4">
        Statistiken uppdateras automatiskt var 30:e sekund. Håll muspekaren över (eller tryck på)
        <Info className="inline h-3.5 w-3.5 mx-1 align-[-2px]" aria-hidden="true" />
        för en förklaring av respektive fält.
      </p>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Hämtar statistik…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ingen data ännu för vald period.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat
              label="Sidvisningar"
              value={totals.byType.page_view ?? 0}
              prev={prevTotals.byType.page_view ?? 0}
              help="Antal gånger startsidan laddats. Samma besökare kan stå för flera sidvisningar."
            />
            <Stat
              label="Unika sessioner"
              value={totals.sessions}
              prev={prevTotals.sessions}
              help="Antal unika besök. En session är en besökare i en webbläsarflik tills fliken stängs."
            />
            <Stat
              label="Utfällda infotexter (i-ikon)"
              value={totals.byType.card_expand ?? 0}
              prev={prevTotals.byType.card_expand ?? 0}
              help="Antal gånger någon klickat på i-ikonen på ett lokalkort för att fälla ut informationstexten om lokalen."
            />
            <Stat
              label="Bokningsklick"
              value={totals.byType.booking_link_click ?? 0}
              prev={prevTotals.byType.booking_link_click ?? 0}
              help="Klick på bokningsknapparna (”Boka nu”, ”Boka grupprum” och ”Se schema”). Uppdelning per knapp visas längre ner."
            />
            <Stat
              label="Kartklick"
              value={totals.byType.map_link_click ?? 0}
              prev={prevTotals.byType.map_link_click ?? 0}
              help="Klick på ”Visa på karta” på ett lokalkort."
            />
            <Stat
              label="Länkklick lokalsida"
              value={totals.byType.space_link_click ?? 0}
              prev={prevTotals.byType.space_link_click ?? 0}
              help="Klick på länkar i lokaltexten som leder vidare till en annan lokal."
            />
            <Stat
              label="Filterändringar"
              value={totals.byType.filter_change ?? 0}
              prev={prevTotals.byType.filter_change ?? 0}
              help="Antal gånger besökare ändrat filter eller sökord. Snabba ändringar i följd räknas som en."
            />
            <Stat
              label="Sök utan träff"
              value={totals.byType.empty_results ?? 0}
              prev={prevTotals.byType.empty_results ?? 0}
              help="Antal gånger en sökning eller filtrering gav noll träffar."
            />
          </div>

          <p className="text-xs text-muted-foreground -mt-2">
            Jämförelse mot föregående period: {format(prevRange.prevFrom, "d MMM", { locale: sv })} – {format(prevRange.prevTo, "d MMM yyyy", { locale: sv })}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Stat
              label="Sessioner som fällde ut infotext"
              value={`${(totals.expandRate * 100).toFixed(1)}%`}
              help="Andel unika besök där någon klickade på i-ikonen på minst ett lokalkort."
            />
            <Stat
              label="Sessioner med bokningsklick"
              value={`${(totals.bookRate * 100).toFixed(1)}%`}
              help="Andel unika besök där någon klickade på en bokningsknapp."
            />
          </div>


          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Section
              title="Valda kategorier"
              help="Hur ofta besökare valt kategorierna Studieplats, Skapande och paus respektive Service och faciliteter i filtreringen."
            >
              {kindBreakdown.length === 0 ? <Empty /> : (
                <ul className="space-y-2">
                  {kindBreakdown.map((k) => (
                    <li key={k.key} className="text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="break-words min-w-0">{k.label}</span>
                        <span className="font-mono tabular-nums text-muted-foreground">
                          {k.count.toLocaleString("sv-SE")} · {(k.pct * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${k.pct * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section
              title="Bokningsklick per knapp"
              help="Visar vilken knapp besökaren klickade på: ”Boka nu” (visas när ett grupprum är ledigt just nu), ”Boka grupprum” eller ”Se schema”."
            >
              {bookingKinds.length === 0 ? <Empty /> : (
                <ul className="divide-y divide-border">
                  {bookingKinds.map((b) => (
                    <li key={b.label} className="flex flex-wrap items-baseline justify-between py-2 text-sm gap-x-3">
                      <span className="break-words min-w-0">{b.label}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">{b.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <Section
            title="Mest engagerande lokaler"
            help="Lokaler med flest interaktioner. Totalen är summan av utfällda infotexter (i-ikonen), bokningsklick och kartklick — varje typ redovisas separat."
          >
            {topCards.length === 0 ? <Empty /> : (
              <ol className="divide-y divide-border">
                {topCards.map((c) => (
                  <li key={c.id} className="py-2 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="break-words min-w-0 font-medium">{c.name}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">{c.count} totalt</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      {c.expand} infotext · {c.booking} bokningsklick · {c.map} kartklick
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Section
              title="Mest använda filter"
              help="Hur ofta varje enskilt filterval förekommer när besökare ändrar filtren. Ett filterbyte kan innehålla flera val samtidigt."
            >
              {topFilters.length === 0 ? <Empty /> : (
                <ol className="divide-y divide-border">
                  {topFilters.map(([label, count]) => (
                    <li key={label} className="flex flex-wrap items-baseline justify-between py-2 text-sm gap-x-3">
                      <span className="break-words min-w-0">{label}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">{count}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
            <Section
              title="Vanligaste sökord"
              help="Vad besökarna skriver i sökrutan (sökrutan söker på lokalnamn)."
            >
              {topQueries.length === 0 ? <Empty /> : (
                <ol className="divide-y divide-border">
                  {topQueries.map(([q, count]) => (
                    <li key={q} className="flex flex-wrap items-baseline justify-between py-2 text-sm gap-x-3">
                      <span className="break-words min-w-0">"{q}"</span>
                      <span className="font-mono tabular-nums text-muted-foreground">{count}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>

          <Section
            title="Mest använda filterkombinationer (topp 10)"
            help="De vanligaste kombinationerna av filter som besökarna faktiskt använder tillsammans."
          >
            {topFilterCombos.length === 0 ? <Empty /> : (
              <ol className="divide-y divide-border">
                {topFilterCombos.map(([label, count]) => (
                  <li key={label} className="flex flex-wrap items-baseline justify-between py-2 text-sm gap-x-3 gap-y-1">
                    <span className="break-words min-w-0">{label}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">{count}</span>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section
            title="Efterfrågan vs utbud per filterkombination"
            help="De vanligaste kombinationerna av minst två filter, jämfört med hur många lokaler som faktiskt matchar hela kombinationen. Få matchande lokaler på en efterfrågad kombination visar var utbudet inte räcker till."
          >
            {comboDemandSupply.length === 0 ? <Empty /> : (
              <ul className="divide-y divide-border">
                {comboDemandSupply.map((item) => {
                  const maxDemand = comboDemandSupply[0]?.demand || 1;
                  const maxSupply = Math.max(1, spaces.length);
                  return (
                    <li key={item.valueKey} className="py-2.5 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="break-words min-w-0">{item.valueLabel}</span>
                        <span className="font-mono tabular-nums text-muted-foreground whitespace-nowrap">
                          {item.demand.toLocaleString("sv-SE")} sökningar · {item.supply} lokal{item.supply === 1 ? "" : "er"}
                        </span>
                      </div>
                      <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Efterfrågan</span>
                          <div className="h-2 rounded bg-muted overflow-hidden mt-0.5">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${Math.min(100, (item.demand / maxDemand) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Utbud (av {spaces.length} lokaler)</span>
                          <div className="h-2 rounded bg-muted overflow-hidden mt-0.5">
                            <div
                              className="h-full bg-emerald-500"
                              style={{ width: `${Math.min(100, (item.supply / maxSupply) * 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {item.supply === 0
                          ? "Ingen lokal matchar hela kombinationen"
                          : item.supply <= 2
                            ? `Endast ${item.supply} lokal${item.supply === 1 ? "" : "er"} matchar – smalt utbud`
                            : `${item.supply} av ${spaces.length} lokaler matchar kombinationen`}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

          </Section>

          <Section
            title="Sökningar utan träff – närmaste alternativ"
            help="Vanliga filterkombinationer som gav noll träffar, med förslag på vilket enskilt filter du kan ta bort för att flest lokaler ska visas."
          >
            {emptyResultsWithSuggestions.length === 0 ? <Empty /> : (
              <ol className="divide-y divide-border">
                {emptyResultsWithSuggestions.map((e, i) => (
                  <li key={i} className="py-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="font-medium break-words min-w-0">{e.filters || "(inga filter)"}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">{e.count} sökningar</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground break-words">{e.suggestion}</div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section
            title="Trender – toppfilter och sökningar utan träff"
            help="Visar hur de fem mest valda filtren och antalet sökningar utan träff har förändrats dag för dag under vald period."
          >
            {trendData.points.length === 0 || trendData.series.length === 0 ? <Empty /> : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData.points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => format(parseISO(v), "d MMM", { locale: sv })} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip labelFormatter={(v) => format(parseISO(String(v)), "d MMMM yyyy", { locale: sv })} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="total" name="Filterändringar" stroke="var(--primary)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="empty" name="Sök utan träff" stroke="var(--destructive, #ef4444)" strokeWidth={2} dot={false} />
                    {trendData.series.map((s, i) => (
                      <Line
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        name={s.label}
                        stroke={TREND_COLORS[(i + 1) % TREND_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Section>

          <Section
            title="Sökningar utan träff (senaste 30)"

            help="Varje gång en besökares sökord och filter gav noll träffar. Visar tidpunkt, sökord, vald kategori och vilka filter som var aktiva."
          >
            {emptySearches.length === 0 ? <Empty /> : (
              <ul className="divide-y divide-border">
                {emptySearches.map((e, i) => (
                  <li key={i} className="py-2 text-sm">
                    <div className="text-xs text-muted-foreground">{e.when}</div>
                    <div className="break-words">
                      {e.query ? <span className="font-medium">"{e.query}"</span> : <span className="italic text-muted-foreground">ingen sökterm</span>}
                      {e.kind && <span className="text-muted-foreground"> · kategori: {e.kind}</span>}
                      {e.workMode && <span className="text-muted-foreground"> · läge: {e.workMode}</span>}
                      {e.cats && <span className="text-muted-foreground"> · {e.cats}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Filterkombinationer som ger 0 träffar (topp 10)"
            help="De vanligaste kombinationerna av filter som gav en tom resultatlista. Bra underlag för att se vad besökarna letar efter men inte hittar."
          >
            {emptyCombos.length === 0 ? <Empty /> : (
              <ol className="divide-y divide-border">
                {emptyCombos.map(([label, count]) => (
                  <li key={label} className="flex flex-wrap items-baseline justify-between py-2 text-sm gap-x-3 gap-y-1">
                    <span className="break-words min-w-0">{label}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">{count}</span>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Section
              title="Enhet (sidvisningar)"
              help="Fördelning mellan mobil, surfplatta och desktop, baserat på sidvisningar."
            >
              {deviceBreakdown.length === 0 ? <Empty /> : (
                <ul className="space-y-2">
                  {deviceBreakdown.map((d) => (
                    <li key={d.key} className="text-sm">
                      <div className="flex items-center justify-between">
                        <span>{d.label}</span>
                        <span className="font-mono tabular-nums text-muted-foreground">
                          {d.count.toLocaleString("sv-SE")} · {(d.pct * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${d.pct * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section
              title="Källor (referrer / UTM)"
              help="Varifrån besökarna kom: ”direkt” = ingen känd hänvisande sida, annars domän eller UTM-kampanj i länken."
            >
              {sourceBreakdown.length === 0 ? <Empty /> : (
                <ol className="divide-y divide-border">
                  {sourceBreakdown.map(([label, count]) => (
                    <li key={label} className="flex flex-wrap items-baseline justify-between py-2 text-sm gap-x-3">
                      <span className="break-words min-w-0">{label}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">{count}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Section
              title="Trafik per timme på dygnet"
              help="Antal sidvisningar fördelat på klockslag (0–23) i vald period. Visar vilka tider tjänsten används mest."
            >
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trafficByHour}>
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="var(--primary)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
            <Section
              title="Trafik per veckodag"
              help="Antal sidvisningar fördelat på veckodag i vald period."
            >
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trafficByWeekday}>
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="var(--primary)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          </div>

          <Section
            title="Delningar"
            help="Klick på delningsikonen på lokalkorten, samt hur många gånger en delad länk faktiskt öppnats av någon."
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Stat label="Delningar" value={shareStats.clicks} prev={prevTotals.byType.share_click ?? 0} />
              <Stat label="Öppnade delade länkar" value={shareStats.opens} prev={prevTotals.byType.share_open ?? 0} />
              <Stat
                label="Öppningar per delning"
                value={`${shareStats.clicks ? Math.round((shareStats.opens / shareStats.clicks) * 100) : 0} %`}
                help="Andel delningar som lett till att någon öppnat länken."
              />
            </div>
            {shareStats.clicks === 0 && shareStats.opens === 0 ? (
              <Empty />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-semibold mb-2">Mest delade lokaler</h4>
                  {shareStats.top.length === 0 ? <Empty /> : (
                    <ol className="divide-y divide-border">
                      {shareStats.top.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-baseline justify-between py-2 text-sm gap-x-3 gap-y-1">
                          <span className="break-words min-w-0">{c.name}</span>
                          <span className="font-mono tabular-nums text-muted-foreground">
                            {c.count} delningar · {c.opens} öppningar
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Delningssätt</h4>
                    {shareStats.methods.length === 0 ? <Empty /> : (
                      <ul className="divide-y divide-border">
                        {shareStats.methods.map((m) => (
                          <li key={m.label} className="flex flex-wrap items-baseline justify-between py-2 text-sm gap-x-3">
                            <span className="break-words min-w-0">{m.label}</span>
                            <span className="font-mono tabular-nums text-muted-foreground">{m.count}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Språk vid delning</h4>
                    {shareStats.langs.length === 0 ? <Empty /> : (
                      <ul className="divide-y divide-border">
                        {shareStats.langs.map((l) => (
                          <li key={l.label} className="flex flex-wrap items-baseline justify-between py-2 text-sm gap-x-3">
                            <span className="break-words min-w-0">{l.label}</span>
                            <span className="font-mono tabular-nums text-muted-foreground">{l.count}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Section>

          <Section
            title="Heatmap: veckodag × timme (sidvisningar)"
            help="Rutnät där varje ruta är en timme en viss veckodag, summerat över hela den valda perioden. Mörkare ruta = fler sidvisningar. Välj en längre period ovan för att se mönster över flera veckor, och växla till snitt per vecka för att jämföra perioder av olika längd."
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="inline-flex overflow-hidden rounded-full border border-border bg-card text-xs">
                {(
                  [
                    { key: "total", label: "Totalt" },
                    { key: "avg", label: "Snitt per vecka" },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setHeatmapMode(m.key)}
                    className={`px-3 py-1.5 ${heatmapMode === m.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                {heatmap.weeks.toFixed(1)} veckor i vald period
              </span>
            </div>
            <Heatmap
              grid={heatmapMode === "avg" ? heatmap.averaged : heatmap.grid}
              max={heatmapMode === "avg" ? heatmap.maxAvg : heatmap.max}
              decimals={heatmapMode === "avg" ? 1 : 0}
            />
          </Section>
        </>

      )}
    </div>
  );
}

function DatePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Date | undefined;
  onChange: (d: Date | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn("w-[200px] justify-start text-left font-normal", !value && "text-muted-foreground")}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value ? format(value, "d MMM yyyy", { locale: sv }) : <span>Välj datum</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={onChange}
            locale={sv}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <button
      type="button"
      tabIndex={0}
      title={text}
      aria-label={text}
      className="inline-flex shrink-0 text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full align-middle"
      onClick={(e) => e.preventDefault()}
    >
      <Info className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

function Stat({ label, value, prev, help }: { label: string; value: number | string; prev?: number; help?: string }) {
  let delta: { pct: number; dir: "up" | "down" | "flat" } | null = null;
  if (typeof value === "number" && typeof prev === "number") {
    if (prev === 0 && value === 0) delta = { pct: 0, dir: "flat" };
    else if (prev === 0) delta = { pct: 100, dir: "up" };
    else {
      const pct = ((value - prev) / prev) * 100;
      delta = { pct, dir: Math.abs(pct) < 2 ? "flat" : pct > 0 ? "up" : "down" };
    }
  }
  const deltaColor =
    delta?.dir === "up" ? "text-emerald-600" : delta?.dir === "down" ? "text-red-600" : "text-muted-foreground";
  const arrow = delta?.dir === "up" ? "▲" : delta?.dir === "down" ? "▼" : "→";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        <span>{label}</span>
        {help && <HelpTip text={help} />}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">
        {typeof value === "number" ? value.toLocaleString("sv-SE") : value}
      </div>
      {delta && (
        <div className={cn("text-xs mt-1 tabular-nums", deltaColor)}>
          {arrow} {delta.pct > 0 ? "+" : ""}{delta.pct.toFixed(1)}% jmf föregående
        </div>
      )}
    </div>
  );
}


function Section({ title, children, help }: { title: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
        <span>{title}</span>
        {help && <HelpTip text={help} />}
      </h3>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-muted-foreground">Ingen data ännu.</p>;
}

function Heatmap({ grid, max, decimals = 0 }: { grid: number[][]; max: number; decimals?: number }) {
  const days = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
  if (max === 0) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="grid" style={{ gridTemplateColumns: "auto repeat(24, minmax(14px, 1fr))", gap: "2px" }}>
          <div />
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={h} className="text-[9px] text-muted-foreground text-center">
              {h % 3 === 0 ? h : ""}
            </div>
          ))}
          {grid.map((row, dow) => (
            <Fragment key={dow}>
              <div className="text-[10px] text-muted-foreground pr-2 self-center">{days[dow]}</div>
              {row.map((v, h) => {
                const intensity = max ? v / max : 0;
                return (
                  <div
                    key={h}
                    title={`${days[dow]} ${String(h).padStart(2, "0")}:00 · ${v.toFixed(decimals)} sidvisningar`}
                    className="aspect-square rounded-sm border border-border/40"
                    style={{
                      backgroundColor: `color-mix(in oklab, var(--primary) ${Math.round((0.06 + intensity * 0.9) * 100)}%, transparent)`,
                    }}

                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

