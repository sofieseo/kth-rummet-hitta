import { test, expect, type FrameLocator, type Page } from "@playwright/test";

const FIXED_OPEN_TIME = new Date("2026-07-30T10:00:00+02:00");

async function waitForApp(page: Page) {
  const main = page.locator("main");
  await expect(main).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
  await expect(main.locator('ul[role="list"] > li').first()).toBeVisible();
}

async function waitForFrameApp(frame: FrameLocator) {
  const main = frame.locator("main");
  await expect(main).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
  await expect(main.locator('ul[role="list"] > li').first()).toBeVisible();
}

async function openApp(page: Page, path = "/") {
  await page.goto(path);
  await waitForApp(page);
}

function desktopFilters(page: Page) {
  return page.getByRole("complementary", { name: "Filter" });
}

function searchParams(page: Page) {
  return new URL(page.url()).searchParams;
}

test.describe("Filtering flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({
      content: `{
        const OriginalDate = Date;
        const fixedTime = ${FIXED_OPEN_TIME.valueOf()};
        class FixedDate extends OriginalDate {
          constructor(...args) {
            super(...(args.length > 0 ? args : [fixedTime]));
          }
          static now() {
            return fixedTime;
          }
        }
        globalThis.Date = FixedDate;
      }`,
    });
  });

  test("loads with the correct title and a canonical default URL", async ({ page }) => {
    await openApp(page);

    await expect(page).toHaveTitle(/Hitta studieplats\s*[–-]\s*KTH Biblioteket/);
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("free-text search is diacritic-insensitive and removable by chip", async ({ page }) => {
    await openApp(page);
    const input = desktopFilters(page).getByPlaceholder(/Sök på lokal/i);

    await input.fill("angdomen");

    await expect.poll(() => searchParams(page).get("q")).toBe("angdomen");
    await expect(page.getByRole("heading", { name: "Ångdomen" })).toBeVisible();
    const chip = page.getByRole("button", {
      name: /Ta bort filter: Sök.*angdomen/i,
    });
    await expect(chip).toBeVisible();

    await chip.click();

    await expect.poll(() => new URL(page.url()).search).toBe("");
    await expect(input).toHaveValue("");
  });

  test("group-room size and deterministic free-now filtering update the URL", async ({ page }) => {
    await openApp(page);
    const filters = desktopFilters(page);

    await filters.getByRole("button", { name: "I grupprum" }).click();
    await expect.poll(() => searchParams(page).get("mode")).toBe("grupprum");

    const size = filters.getByRole("button", { name: /5\+ pers/ });
    await expect(size).toBeVisible();
    await size.click();
    await expect.poll(() => searchParams(page).get("size")).toBe("5+");

    const freeOnly = filters.getByRole("checkbox", {
      name: /Visa bara lediga just nu/,
    });
    await expect(freeOnly).toBeVisible();
    await freeOnly.check();
    await expect.poll(() => searchParams(page).get("free")).toBe("true");

    await expect(page.getByRole("heading", { name: "Södra arkaden" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Grupprum Övre" })).not.toBeVisible();
  });

  test("switching away from group rooms removes size and free-only", async ({ page }) => {
    await openApp(page);
    const filters = desktopFilters(page);

    await filters.getByRole("button", { name: "I grupprum" }).click();
    await filters.getByRole("button", { name: /5\+ pers/ }).click();
    await filters.getByRole("checkbox", { name: /Visa bara lediga just nu/ }).check();
    await filters.getByRole("button", { name: "Enskilt" }).click();

    await expect.poll(() => searchParams(page).get("mode")).toBe("enskilt");
    await expect.poll(() => searchParams(page).get("size")).toBeNull();
    await expect.poll(() => searchParams(page).get("free")).toBeNull();
  });

  test("clear all returns to the canonical default without adding history", async ({ page }) => {
    await openApp(page);
    const filters = desktopFilters(page);
    const initialHistoryLength = await page.evaluate(() => history.length);

    await filters.getByPlaceholder(/Sök på lokal/i).fill("steam");
    await filters.getByRole("button", { name: "Tillsammans" }).click();
    await expect.poll(() => searchParams(page).get("mode")).toBe("tillsammans");
    const clearAll = filters.getByRole("button", { name: /Rensa alla/i });
    await expect(clearAll).toBeVisible();

    await clearAll.click();

    await expect.poll(() => new URL(page.url()).search).toBe("");
    expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength);
  });

  test("invalid and stale deep-link state is dynamically canonicalized", async ({ page }) => {
    const cats = encodeURIComponent(
      JSON.stringify({
        noise: ["Tyst", "Dold ljudnivå", "Okänd"],
        equipment: ["Dator", "Dold skärm"],
        stale_category: ["Spöke"],
      }),
    );
    await openApp(
      page,
      `/?mode=enskilt&size=5%2B&free=1&cats=${cats}&sort=name_asc&highlight=angdomen`,
    );

    await expect.poll(() => searchParams(page).get("size")).toBeNull();
    await expect.poll(() => searchParams(page).get("free")).toBeNull();
    await expect.poll(() => searchParams(page).get("sort")).toBe("name_asc");
    await expect.poll(() => searchParams(page).get("highlight")).toBe("angdomen");
    await expect
      .poll(() => JSON.parse(searchParams(page).get("cats") ?? "{}"))
      .toEqual({ noise: ["Tyst"], equipment: ["Dator"] });
    await expect(page.getByRole("button", { name: /Dold|Okänd|Spöke/ })).toHaveCount(0);

    await openApp(page, "/?mode=nonsense");
    await expect.poll(() => searchParams(page).get("mode")).toBeNull();
    await expect(page.getByRole("button", { name: /nonsense/i })).toHaveCount(0);

    await openApp(page, "/?kind=nonsense");
    await expect.poll(() => searchParams(page).get("kind")).toBeNull();
    await expect(page.getByRole("heading", { name: "Ångdomen" })).toBeVisible();
  });

  test("valid DB-driven kinds and work modes are preserved", async ({ page }) => {
    await openApp(page, "/?kind=custom_kind");
    await expect.poll(() => searchParams(page).get("kind")).toBe("custom_kind");
    await expect(page.getByRole("heading", { name: "Dynamisk lokal" })).toBeVisible();

    await openApp(page, "/?mode=fokus");
    await expect.poll(() => searchParams(page).get("mode")).toBe("fokus");
    await expect(page.getByRole("button", { name: /Ta bort filter: Fokusarbete/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ångdomen" })).toBeVisible();
  });

  test("hidden pill and list options never appear in the public desktop filter", async ({
    page,
  }) => {
    await openApp(page);
    const filters = desktopFilters(page);

    await expect(filters.getByRole("button", { name: "Dold ljudnivå" })).toHaveCount(0);
    await filters.getByRole("button", { name: "Utrustning" }).click();
    await expect(filters.getByRole("button", { name: "Dator" })).toBeVisible();
    await expect(filters.getByRole("button", { name: "Dold skärm" })).toHaveCount(0);
  });

  test("each result card uses three composite Tab stops", async ({ page }) => {
    await openApp(page);

    const card = page.locator("#space-angdomen");
    const title = card.getByRole("button", { name: "Ångdomen", exact: true });
    const description = card.getByText("Testbeskrivning för Ångdomen.");

    await title.focus();
    await expect(title).toBeFocused();
    await expect(title).toHaveAttribute("aria-expanded", "false");
    await expect(description).toBeHidden();

    await page.keyboard.press("Enter");
    await expect(title).toHaveAttribute("aria-expanded", "true");
    await expect(description).toBeVisible();

    await page.keyboard.press("ArrowRight");
    await expect(card.getByRole("button", { name: "Enskilt", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(card.getByRole("button", { name: "Tillsammans", exact: true })).toBeFocused();

    await page.keyboard.press("Tab");
    const gallery = card.getByRole("button", { name: /Bildgalleri för Ångdomen/ });
    await expect(gallery).toBeFocused();
    await expect(gallery).toHaveAccessibleName(/bild 1 av 2/i);

    // The visible mouse/touch controls remain usable without becoming extra
    // keyboard or screen-reader controls.
    await gallery.hover();
    await card.locator('[data-gallery-action="next"]').click();
    await expect(gallery).toHaveAccessibleName(/bild 2 av 2/i);
    await card.locator('[data-gallery-index="0"]').click();
    await expect(gallery).toHaveAccessibleName(/bild 1 av 2/i);
    await expect(gallery).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(gallery).toHaveAccessibleName(/bild 2 av 2/i);
    await expect(gallery).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Bildgalleri" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(gallery).toBeFocused();

    await page.keyboard.press("Tab");
    const mapLink = card.getByRole("link", { name: /Visa på karta/ });
    const scheduleLink = card.getByRole("link", { name: /Se schema/ });
    await expect(mapLink).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(scheduleLink).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(
      page.locator("#space-sodra-arkaden").getByRole("button", {
        name: "Södra arkaden",
        exact: true,
      }),
    ).toBeFocused();
  });

  test("mobile filters keep a draft, discard it on Escape, and apply explicitly", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const dialogErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /DialogContent|DialogTitle/.test(message.text())) {
        dialogErrors.push(message.text());
      }
    });
    await openApp(page);
    const trigger = page.getByRole("button", { name: /^Filter$/ });

    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Filter" });
    await expect(dialog.getByRole("button", { name: "Dold ljudnivå" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Utrustning" }).click();
    await expect(dialog.getByRole("button", { name: "Dold skärm" })).toHaveCount(0);

    const input = dialog.getByPlaceholder(/Sök på lokal/i);
    await input.fill("angdomen");
    await expect.poll(() => new URL(page.url()).search).toBe("");

    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();

    await trigger.click();
    const reopened = page.getByRole("dialog", { name: "Filter" });
    await expect(reopened.getByPlaceholder(/Sök på lokal/i)).toHaveValue("");
    await reopened.getByPlaceholder(/Sök på lokal/i).fill("angdomen");
    await reopened.getByRole("button", { name: /Visa resultat \(\d+\)/ }).click();

    await expect.poll(() => searchParams(page).get("q")).toBe("angdomen");
    await expect(page.getByRole("heading", { name: "Ångdomen" })).toBeVisible();

    await page.getByRole("button", { name: /English/ }).click();
    const englishTrigger = page.getByRole("button", { name: "Filters", exact: true });
    await englishTrigger.click();
    await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(englishTrigger).toBeFocused();
    expect(dialogErrors).toEqual([]);
  });

  test("mobile filters remain reachable in a tall, scrolled iframe", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 844 });
    await page.route("http://localhost:8080/__e2e__/iframe", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `
          <!doctype html>
          <style>
            body { margin: 0; height: 2400px; }
            .spacer { height: 500px; }
            iframe { display: block; width: 390px; height: 1500px; border: 0; }
          </style>
          <div class="spacer"></div>
          <iframe title="KTH filtertest" src="/"></iframe>
        `,
      }),
    );

    await page.goto("/__e2e__/iframe");
    await page.evaluate(() => window.scrollTo(0, 650));
    const frame = page.frameLocator('iframe[title="KTH filtertest"]');
    await waitForFrameApp(frame);
    const trigger = frame.getByRole("button", { name: /^Filter$/ });
    await expect(trigger).toBeVisible();

    const triggerBox = await trigger.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(triggerBox?.y).toBeGreaterThanOrEqual(0);
    expect((triggerBox?.y ?? 0) + (triggerBox?.height ?? 0)).toBeLessThanOrEqual(844);

    await trigger.click();
    const dialog = frame.getByRole("dialog", { name: "Filter" });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(700);
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox?.y).toBeGreaterThanOrEqual(0);
    expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(844);
  });
});
