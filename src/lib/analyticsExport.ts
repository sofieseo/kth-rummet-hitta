import * as XLSX from "xlsx";

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

type EmptyWithSuggestion = {
  filters: string;
  count: number;
  suggestion: string;
};

type TrendPoint = {
  date: string;
  total: number;
  empty: number;
  [seriesKey: string]: number | string;
};

type TrendData = {
  points: TrendPoint[];
  series: { key: string; label: string }[];
};

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function exportAnalyticsToExcel(
  rows: Row[],
  from: Date,
  to: Date,
  extra?: {
    demandSupply: DemandSupplyItem[];
    emptyWithAlternatives: EmptyWithSuggestion[];
    trend: TrendData;
  },
): void {

  const wb = XLSX.utils.book_new();

  // Summary
  const byType: Record<string, number> = {};
  const sessions = new Set<string>();
  const sessionsExpanded = new Set<string>();
  const sessionsBooked = new Set<string>();
  for (const r of rows) {
    byType[r.event_type] = (byType[r.event_type] ?? 0) + 1;
    if (r.session_id) sessions.add(r.session_id);
    if (r.event_type === "card_expand" && r.session_id) sessionsExpanded.add(r.session_id);
    if (r.event_type === "booking_link_click" && r.session_id) sessionsBooked.add(r.session_id);
  }
  const totalSessions = sessions.size || 1;
  const summary: (string | number)[][] = [
    ["Period från", fmtDate(from)],
    ["Period till", fmtDate(to)],
    [],
    ["Sidvisningar", byType.page_view ?? 0],
    ["Unika sessioner", sessions.size],
    ["Kortklick (expand)", byType.card_expand ?? 0],
    ["Bokningsklick", byType.booking_link_click ?? 0],
    ["Kartklick", byType.map_link_click ?? 0],
    ["Länkklick till lokalsida", byType.space_link_click ?? 0],
    ["Delningar", byType.share_click ?? 0],
    ["Öppnade delade länkar", byType.share_open ?? 0],
    ["Filterändringar", byType.filter_change ?? 0],
    ["Sök utan träff", byType.empty_results ?? 0],
    ["Totalt händelser", rows.length],
    [],
    ["Andel sessioner som expanderade kort", `${((sessionsExpanded.size / totalSessions) * 100).toFixed(1)}%`],
    ["Andel sessioner med bokningsklick", `${((sessionsBooked.size / totalSessions) * 100).toFixed(1)}%`],
  ];
  const kindLabels: Record<string, string> = {
    study: "Studieplats",
    creative: "Skapande och paus",
    service: "Service och faciliteter",
  };
  const kindCounts: Record<string, number> = {};
  const bookingKindCounts: Record<string, number> = {};
  for (const r of rows) {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    if (r.event_type === "filter_change" && p.spaceKind) {
      const k = kindLabels[String(p.spaceKind)] ?? String(p.spaceKind);
      kindCounts[k] = (kindCounts[k] ?? 0) + 1;
    }
    if (r.event_type === "booking_link_click") {
      const labels: Record<string, string> = {
        book_now: "Boka nu",
        group_booking: "Boka grupprum",
        booking: "Se schema",
      };
      const k = labels[String(p.kind ?? "")] ?? "Okänd knapp";
      bookingKindCounts[k] = (bookingKindCounts[k] ?? 0) + 1;
    }
  }
  summary.push([], ["Valda kategorier", ""]);
  for (const [k, v] of Object.entries(kindCounts).sort((a, b) => b[1] - a[1])) summary.push([k, v]);
  summary.push([], ["Bokningsklick per knapp", ""]);
  for (const [k, v] of Object.entries(bookingKindCounts).sort((a, b) => b[1] - a[1])) summary.push([k, v]);

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Sammanfattning");

  // Lokaler
  const locCounts: Record<string, { name: string; expand: number; booking: number; map: number }> = {};
  for (const r of rows) {
    if (!["card_expand", "booking_link_click", "map_link_click"].includes(r.event_type)) continue;
    const id = String((r.payload as { space_id?: string } | null)?.space_id ?? "");
    if (!id) continue;
    const name = String((r.payload as { name?: string } | null)?.name ?? id);
    const e = locCounts[id] ?? { name, expand: 0, booking: 0, map: 0 };
    if (r.event_type === "card_expand") e.expand++;
    else if (r.event_type === "booking_link_click") e.booking++;
    else if (r.event_type === "map_link_click") e.map++;
    locCounts[id] = e;
  }
  const locRows = [
    ["Lokal", "Expand", "Bokningsklick", "Kartklick", "Totalt"],
    ...Object.values(locCounts)
      .map((v) => [v.name, v.expand, v.booking, v.map, v.expand + v.booking + v.map])
      .sort((a, b) => (b[4] as number) - (a[4] as number)),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(locRows), "Lokaler");

  // Filter
  const filterCounts: Record<string, number> = {};
  const queryCounts: Record<string, number> = {};
  for (const r of rows) {
    if (r.event_type !== "filter_change") continue;
    const p = (r.payload ?? {}) as Record<string, unknown>;
    if (p.query) {
      filterCounts["sökord"] = (filterCounts["sökord"] ?? 0) + 1;
      const q = String(p.query).trim().toLowerCase();
      if (q) queryCounts[q] = (queryCounts[q] ?? 0) + 1;
    }
    if (p.workMode) filterCounts[`läge: ${String(p.workMode)}`] = (filterCounts[`läge: ${String(p.workMode)}`] ?? 0) + 1;
    if (p.groupSize) filterCounts[`storlek: ${String(p.groupSize)}`] = (filterCounts[`storlek: ${String(p.groupSize)}`] ?? 0) + 1;
    if (p.freeOnly) filterCounts["endast lediga grupprum"] = (filterCounts["endast lediga grupprum"] ?? 0) + 1;
    const cats = (p.categories ?? {}) as Record<string, string[]>;
    for (const [cat, vals] of Object.entries(cats)) {
      for (const v of vals ?? []) filterCounts[`${cat}: ${v}`] = (filterCounts[`${cat}: ${v}`] ?? 0) + 1;
    }
  }
  const filterRows = [
    ["Filter", "Antal"],
    ...Object.entries(filterCounts).sort((a, b) => b[1] - a[1]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filterRows), "Filter");

  // Sökord
  const queryRows = [
    ["Sökord", "Antal"],
    ...Object.entries(queryCounts).sort((a, b) => b[1] - a[1]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(queryRows), "Sökord");

  // Sök utan träff
  const emptyRows: (string | number)[][] = [["Tid", "Sökord", "Läge", "Kategorier"]];
  for (const r of rows) {
    if (r.event_type !== "empty_results") continue;
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const cats = Object.entries((p.categories ?? {}) as Record<string, string[]>)
      .map(([k, v]) => `${k}: ${(v ?? []).join(", ")}`)
      .join(" · ");
    emptyRows.push([
      new Date(r.created_at).toLocaleString("sv-SE"),
      p.query ? String(p.query) : "",
      p.workMode ? String(p.workMode) : "",
      cats,
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(emptyRows), "Sök utan träff");

  // Filter utan träff (kombinationer)
  const comboCounts: Record<string, number> = {};
  for (const r of rows) {
    if (r.event_type !== "empty_results") continue;
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const parts: string[] = [];
    if (p.workMode) parts.push(`läge:${String(p.workMode)}`);
    if (p.freeOnly) parts.push("endast lediga");
    const cats = (p.categories ?? {}) as Record<string, string[]>;
    for (const [k, v] of Object.entries(cats)) {
      for (const val of (v ?? []).slice().sort()) parts.push(`${k}:${val}`);
    }
    const key = parts.length ? parts.sort().join(" · ") : "(inga filter)";
    comboCounts[key] = (comboCounts[key] ?? 0) + 1;
  }
  const comboRows = [
    ["Filterkombination", "Antal"],
    ...Object.entries(comboCounts).sort((a, b) => b[1] - a[1]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(comboRows), "Filter utan träff");

  // Källor
  const srcCounts: Record<string, { referrer: string; utm_source: string; utm_medium: string; utm_campaign: string; count: number }> = {};
  const deviceCounts: Record<string, number> = {};
  for (const r of rows) {
    if (r.event_type !== "page_view") continue;
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const referrer = String(p.referrer ?? "direkt");
    const utm_source = String(p.utm_source ?? "");
    const utm_medium = String(p.utm_medium ?? "");
    const utm_campaign = String(p.utm_campaign ?? "");
    const key = `${referrer}|${utm_source}|${utm_medium}|${utm_campaign}`;
    const e = srcCounts[key] ?? { referrer, utm_source, utm_medium, utm_campaign, count: 0 };
    e.count++;
    srcCounts[key] = e;
    const dev = String(p.device ?? "okänd");
    deviceCounts[dev] = (deviceCounts[dev] ?? 0) + 1;
  }
  const srcRows: (string | number)[][] = [["Referrer", "utm_source", "utm_medium", "utm_campaign", "Sidvisningar"]];
  for (const v of Object.values(srcCounts).sort((a, b) => b.count - a.count)) {
    srcRows.push([v.referrer, v.utm_source, v.utm_medium, v.utm_campaign, v.count]);
  }
  srcRows.push([], ["Enhet", "Sidvisningar"]);
  for (const [d, c] of Object.entries(deviceCounts).sort((a, b) => b[1] - a[1])) {
    srcRows.push([d, c]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(srcRows), "Källor");


  // Råhändelser
  const rawRows: (string | number)[][] = [["Tid", "Typ", "Path", "Session", "Payload"]];
  for (const r of rows) {
    rawRows.push([
      new Date(r.created_at).toLocaleString("sv-SE"),
      r.event_type,
      r.path ?? "",
      r.session_id ?? "",
      r.payload ? JSON.stringify(r.payload) : "",
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rawRows), "Råhändelser");

  XLSX.writeFile(wb, `statistik_${fmtDate(from)}_till_${fmtDate(to)}.xlsx`);
}
