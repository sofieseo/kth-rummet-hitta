import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Download, Info } from "lucide-react";
import { sv } from "date-fns/locale";
import { format } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import { exportAnalyticsToExcel } from "@/lib/analyticsExport";

type Row = {
  id: number;
  event_type: string;
  payload: Record<string, unknown> | null;
  session_id: string | null;
  path: string | null;
  created_at: string;
};

const PRESETS = [
  { key: "24h", label: "24 timmar", hours: 24 },
  { key: "7d", label: "7 dagar", hours: 24 * 7 },
  { key: "30d", label: "30 dagar", hours: 24 * 30 },
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

export function AnalyticsTab() {
  const [preset, setPreset] = useState<PresetKey>("7d");
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

  const heatmap = useMemo(() => {
    // 7 rows (Mon-Sun) x 24 cols
    const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const r of rows) {
      if (r.event_type !== "page_view") continue;
      const d = new Date(r.created_at);
      const dow = (d.getDay() + 6) % 7; // Mon=0
      grid[dow][d.getHours()]++;
    }
    let max = 0;
    for (const row of grid) for (const v of row) if (v > max) max = v;
    return { grid, max };
  }, [rows]);


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
            onClick={() => exportAnalyticsToExcel(rows, from, to)}
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
            help="Rutnät där varje ruta är en timme en viss veckodag. Mörkare ruta = fler sidvisningar."
          >
            <Heatmap grid={heatmap.grid} max={heatmap.max} />
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

function Heatmap({ grid, max }: { grid: number[][]; max: number }) {
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
                    title={`${days[dow]} ${String(h).padStart(2, "0")}:00 · ${v} sidvisningar`}
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

