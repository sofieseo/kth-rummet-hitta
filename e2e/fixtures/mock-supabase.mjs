import { createServer, request as httpRequest } from "node:http";

const port = Number(process.env.E2E_SUPABASE_PORT ?? 8080);
const appPort = Number(process.env.E2E_APP_PORT ?? 8787);

const categories = [
  {
    id: "category-kind",
    key: "space_kind",
    title: "Vad letar du efter?",
    title_en: "What are you looking for?",
    style: "pills",
    match_mode: "any",
    is_single_select: true,
    locked: true,
    sort_order: 10,
    special_kind: "space_kind",
  },
  {
    id: "category-mode",
    key: "arbetssatt",
    title: "Hur vill du arbeta?",
    title_en: "How do you want to work?",
    style: "pills",
    match_mode: "any",
    is_single_select: true,
    locked: true,
    sort_order: 20,
    special_kind: "arbetssatt",
  },
  {
    id: "category-noise",
    key: "noise",
    title: "Ljudnivå",
    title_en: "Noise level",
    style: "pills",
    match_mode: "any",
    is_single_select: false,
    locked: true,
    sort_order: 30,
    special_kind: null,
  },
  {
    id: "category-equipment",
    key: "equipment",
    title: "Utrustning",
    title_en: "Equipment",
    style: "list",
    match_mode: "all",
    is_single_select: false,
    locked: true,
    sort_order: 40,
    special_kind: null,
  },
];

function option({ id, category, label, labelEn, valueKey = null, hidden = false, sortOrder = 10 }) {
  return {
    id,
    category,
    label,
    label_en: labelEn ?? null,
    icon_url: null,
    default_icon: null,
    sort_order: sortOrder,
    value_key: valueKey,
    is_seed: true,
    hidden,
  };
}

const options = [
  option({
    id: "kind-study",
    category: "space_kind",
    label: "En studieplats",
    labelEn: "A study space",
    valueKey: "study",
  }),
  option({
    id: "kind-service",
    category: "space_kind",
    label: "Service & faciliteter",
    labelEn: "Services & facilities",
    valueKey: "service",
    sortOrder: 20,
  }),
  option({
    id: "kind-creative",
    category: "space_kind",
    label: "Skapande & paus",
    labelEn: "Creativity & breaks",
    valueKey: "creative",
    sortOrder: 30,
  }),
  option({
    id: "kind-custom",
    category: "space_kind",
    label: "Dynamisk lokaltyp",
    labelEn: "Dynamic space kind",
    valueKey: "custom_kind",
    sortOrder: 40,
  }),
  option({
    id: "mode-alone",
    category: "arbetssatt",
    label: "Enskilt",
    labelEn: "Alone",
    valueKey: "enskilt",
  }),
  option({
    id: "mode-together",
    category: "arbetssatt",
    label: "Tillsammans",
    labelEn: "Together",
    valueKey: "tillsammans",
    sortOrder: 20,
  }),
  option({
    id: "mode-group",
    category: "arbetssatt",
    label: "I grupprum",
    labelEn: "In a group room",
    valueKey: "grupprum",
    sortOrder: 30,
  }),
  option({
    id: "mode-focus",
    category: "arbetssatt",
    label: "Fokusarbete",
    labelEn: "Focused work",
    valueKey: "fokus",
    sortOrder: 40,
  }),
  option({
    id: "noise-quiet",
    category: "noise",
    label: "Tyst",
    labelEn: "Quiet",
  }),
  option({
    id: "noise-conversation",
    category: "noise",
    label: "Samtalston",
    labelEn: "Conversation",
    sortOrder: 20,
  }),
  option({
    id: "noise-hidden",
    category: "noise",
    label: "Dold ljudnivå",
    labelEn: "Hidden noise level",
    hidden: true,
    sortOrder: 30,
  }),
  option({
    id: "equipment-computer",
    category: "equipment",
    label: "Dator",
    labelEn: "Computer",
  }),
  option({
    id: "equipment-whiteboard",
    category: "equipment",
    label: "Whiteboard",
    labelEn: "Whiteboard",
    sortOrder: 20,
  }),
  option({
    id: "equipment-hidden",
    category: "equipment",
    label: "Dold skärm",
    labelEn: "Hidden screen",
    hidden: true,
    sortOrder: 30,
  }),
];

function space(overrides) {
  return {
    id: overrides.id,
    slug: overrides.id,
    name: overrides.name,
    name_en: overrides.name_en ?? null,
    space_kind: overrides.space_kind ?? "study",
    category: "",
    description: overrides.description ?? `Testbeskrivning för ${overrides.name}.`,
    description_en: null,
    description_inline: overrides.description_inline ?? false,
    intent: overrides.intent ?? ["enskilt"],
    noise: overrides.noise ?? ["Tyst"],
    equipment: overrides.equipment ?? [],
    facilities: overrides.facilities ?? [],
    lokaltyp: overrides.lokaltyp ?? ["Öppen studieyta"],
    image_url: overrides.image_url ?? null,
    images: overrides.images ?? [],
    image_alts: overrides.image_alts ?? [],
    image_alts_en: overrides.image_alts_en ?? [],
    map_url: overrides.map_url ?? null,
    map_url_en: null,
    booking_url: overrides.booking_url ?? null,
    booking_url_en: null,
    group_booking_url: overrides.group_booking_url ?? null,
    group_booking_url_en: null,
    group_booking_label: null,
    group_booking_label_en: null,
    book_now_url: null,
    book_now_url_en: null,
    sort_order: overrides.sort_order ?? 10,
    floor: overrides.floor ?? "Plan 2",
    floor_en: overrides.floor_en ?? "Floor 2",
    located_in: overrides.located_in ?? "KTH Biblioteket",
    located_in_en: overrides.located_in_en ?? "KTH Library",
    capacity: overrides.capacity ?? 4,
    computer_count: overrides.computer_count ?? 0,
    informal_seat_count: overrides.informal_seat_count ?? 0,
    tags: {},
    notice: null,
    notice_en: null,
    info: null,
    info_en: null,
    show_capacity_publicly: true,
    show_occupancy: false,
    countmatters_sensor_id: null,
    booking_room_number: overrides.booking_room_number ?? null,
    hidden: false,
  };
}

const spaces = [
  space({
    id: "angdomen",
    name: "Ångdomen",
    name_en: "The Steam Dome",
    description:
      "Testbeskrivning för Ångdomen.<br><br>" +
      "Lokalen har flera olika studieytor och den här längre texten verifierar att bilden fyller hela kortets höjd när beskrivningen fälls ut. ".repeat(
        7,
      ),
    intent: ["enskilt", "tillsammans", "fokus"],
    equipment: ["Dator"],
    images: ["/__e2e__/image-blue.svg", "/__e2e__/image-gold.svg"],
    image_alts: ["Blå testbild", "Gul testbild"],
    map_url: "#map-angdomen",
    booking_url: "#schedule-angdomen",
    capacity: 12,
    sort_order: 10,
  }),
  space({
    id: "sodra-arkaden",
    name: "Södra arkaden",
    name_en: "South Arcade",
    intent: ["grupprum"],
    noise: ["Samtalston"],
    equipment: ["Whiteboard"],
    lokaltyp: ["Grupprum"],
    capacity: 6,
    booking_room_number: 1,
    sort_order: 20,
  }),
  space({
    id: "grupprum-ovre",
    name: "Grupprum Övre",
    name_en: "Upper Group Room",
    intent: ["grupprum"],
    noise: ["Samtalston"],
    equipment: ["Dator", "Whiteboard"],
    lokaltyp: ["Grupprum"],
    capacity: 3,
    booking_room_number: 2,
    sort_order: 30,
  }),
  ...Array.from({ length: 12 }, (_, index) =>
    space({
      id: `studieyta-${index + 1}`,
      name: `Studieyta ${String(index + 1).padStart(2, "0")}`,
      name_en: `Study Area ${String(index + 1).padStart(2, "0")}`,
      intent: index === 0 ? ["enskilt", "fokus"] : ["enskilt", "tillsammans"],
      noise: index % 2 === 0 ? ["Tyst"] : ["Samtalston"],
      equipment: index % 3 === 0 ? ["Dator"] : [],
      sort_order: 100 + index,
    }),
  ),
  space({
    id: "service-printer",
    name: "Skrivare",
    name_en: "Printer",
    space_kind: "service",
    intent: [],
    lokaltyp: ["Service"],
    sort_order: 300,
  }),
  space({
    id: "creative-break",
    name: "Pausyta",
    name_en: "Break area",
    space_kind: "creative",
    intent: [],
    lokaltyp: ["Paus"],
    sort_order: 310,
  }),
  space({
    id: "custom-space",
    name: "Dynamisk lokal",
    name_en: "Dynamic space",
    space_kind: "custom_kind",
    intent: [],
    lokaltyp: ["Dynamisk"],
    sort_order: 320,
  }),
];

const allDaySchedule = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [
    day,
    { enabled: true, from: "00:00", to: "23:59" },
  ]),
);

const settings = new Map([
  ["occupancy_enabled_global", "true"],
  ["occupancy_schedule", JSON.stringify(allDaySchedule)],
  ["announcement_enabled", "false"],
  ["announcement_sv", ""],
  ["announcement_en", ""],
]);

function selectedFields(row, select) {
  if (!select || select === "*") return row;
  return Object.fromEntries(
    select
      .split(",")
      .map((field) => field.trim())
      .filter((field) => field in row)
      .map((field) => [field, row[field]]),
  );
}

function settingRows(url) {
  const select = url.searchParams.get("select");
  const keyFilter = url.searchParams.get("key");
  let keys = [...settings.keys()];

  if (keyFilter?.startsWith("eq.")) {
    keys = [keyFilter.slice(3)];
  } else if (keyFilter?.startsWith("in.(") && keyFilter.endsWith(")")) {
    keys = keyFilter.slice(4, -1).split(",");
  }

  return keys
    .filter((key) => settings.has(key))
    .map((key) => selectedFields({ key, value: settings.get(key) }, select));
}

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function proxyToApp(request, response) {
  const upstream = httpRequest(
    {
      hostname: "127.0.0.1",
      port: appPort,
      path: request.url,
      method: request.method,
      headers: {
        ...request.headers,
        host: `127.0.0.1:${appPort}`,
      },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("error", (error) => {
    if (!response.headersSent) {
      sendJson(response, 502, { message: `App server unavailable: ${error.message}` });
    } else {
      response.destroy(error);
    }
  });

  request.pipe(upstream);
}

const server = createServer((request, response) => {
  if (!request.url) {
    sendJson(response, 400, { message: "Missing URL" });
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    });
    response.end();
    return;
  }

  const url = new URL(request.url, `http://127.0.0.1:${port}`);

  if (url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/__e2e__/image-blue.svg" || url.pathname === "/__e2e__/image-gold.svg") {
    const color = url.pathname.endsWith("gold.svg") ? "#f2c94c" : "#007fa3";
    response.writeHead(200, {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><rect width="960" height="640" fill="${color}"/></svg>`,
    );
    return;
  }

  if (url.pathname === "/rest/v1/spaces") {
    sendJson(response, 200, spaces, {
      "content-range": `0-${spaces.length - 1}/${spaces.length}`,
    });
    return;
  }

  if (url.pathname === "/rest/v1/filter_categories") {
    sendJson(response, 200, categories, {
      "content-range": `0-${categories.length - 1}/${categories.length}`,
    });
    return;
  }

  if (url.pathname === "/rest/v1/filter_options") {
    sendJson(response, 200, options, {
      "content-range": `0-${options.length - 1}/${options.length}`,
    });
    return;
  }

  if (url.pathname === "/rest/v1/app_settings") {
    const rows = settingRows(url);
    const wantsObject = request.headers.accept?.includes("application/vnd.pgrst.object+json");
    sendJson(response, 200, wantsObject ? (rows[0] ?? null) : rows, {
      "content-range": rows.length > 0 ? `0-${rows.length - 1}/${rows.length}` : "*/0",
    });
    return;
  }

  if (url.pathname === "/rest/v1/analytics_events") {
    sendJson(response, 201, []);
    return;
  }

  if (url.pathname.startsWith("/bookingsystem/v1/roomsavailability/grouprooms/1/")) {
    sendJson(response, 200, [
      {
        room_number: 1,
        disabled: 0,
        availability: true,
        status: "free",
      },
      {
        room_number: 2,
        disabled: 0,
        availability: false,
        status: "confirmed",
      },
    ]);
    return;
  }

  proxyToApp(request, response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`E2E reverse proxy listening on http://127.0.0.1:${port} (app :${appPort})`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
