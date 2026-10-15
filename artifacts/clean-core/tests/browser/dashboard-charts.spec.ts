import { test, expect } from "./fixtures/accounts";
import { type Page, type Locator } from "@playwright/test";

// Unequal counts catch swapped labels, equal-size slices and stale chart data.
const levels = [
  { name: "Level A", count: 4, color: "#10b981" },
  { name: "Level B", count: 3, color: "#3b82f6" },
  { name: "Level C", count: 2, color: "#f59e0b" },
  { name: "Level D", count: 1, color: "#ef4444" },
];
const dimensions = [
  { name: "Extensibility", count: 5 },
  { name: "Integration", count: 3 },
  { name: "Data", count: 2 },
];
const inventory = levels.flatMap(level => Array.from({ length: level.count }, () => level.name.slice(-1)))
  .map((classification, i) => ({
    id: `chart-${i}`, objectName: `Z_CHART_${i}`, classification,
    dimension: i < 5 ? "Extensibility" : i < 8 ? "Integration" : "Data",
    confidence: "high", dependencies: [],
  }));

function assessment(items = inventory) {
  return {
    system: "PRD", targetRelease: "S4HANA_2023", inventory: items,
    cleanCoreShare: 70, technicalDebtScore: 12, totals: { objects: items.length },
    evidenceQuality: { confidence: "high" }, roadmap: { waves: [] },
    provenance: { generatedAt: "2026-01-01T00:00:00.000Z", engineVersion: "chart-fixture" },
  };
}

function charts(page: Page) {
  const pie = page.locator(".recharts-wrapper").filter({ has: page.locator(".recharts-pie") });
  // Empty pies have no .recharts-pie; scope using the persistent card title instead.
  const card = (title: string) => page.getByText(title, { exact: true }).locator("../..");
  return {
    pie: card("Classification Distribution"),
    bars: card("Findings by Dimension"),
    slices: pie.locator(".recharts-pie-sector path"),
  };
}

async function load(page: Page, items = inventory) {
  // Only chart inputs are stubbed. The real dashboard derives the distributions,
  // lazy-loads DashboardCharts and renders real Recharts SVGs.
  await page.route("**/api/clean-core/demo", route =>
    route.fulfill({ json: { evidence: [], assessment: assessment(items) } }));
  await page.goto("./");
  await page.getByTestId("button-empty-load-demo").click();
  await expect(charts(page).pie.locator(".recharts-surface").first()).toBeVisible();
}

async function tooltip(chart: Locator, label: string, value: number, key = label) {
  const tip = chart.locator(".recharts-tooltip-wrapper");
  await expect(tip).toBeVisible();
  await expect(tip.locator(".recharts-tooltip-item-name")).toHaveText(key);
  await expect(tip.locator(".recharts-tooltip-item-value")).toHaveText(String(value));
  await expect(tip).toContainText(label);
}

async function assertPopulated(page: Page) {
  const { pie, bars, slices } = charts(page);
  await expect(pie.getByText("No classified values to display.", { exact: true })).toHaveCount(0);
  await expect(bars.getByText("No findings to display by dimension.", { exact: true })).toHaveCount(0);
  await expect(slices).toHaveCount(4);
  const legend = pie.locator(".recharts-legend-item");
  await expect(legend).toHaveCount(4);
  for (const [i, level] of levels.entries()) {
    await expect(slices.nth(i)).toHaveAttribute("fill", level.color);
    await expect(legend.nth(i)).toHaveText(level.name);
    await expect(legend.nth(i).locator("svg path")).toHaveAttribute("fill", level.color);
    // Hover the filled sector, not the donut's empty bounding-box center.
    await slices.nth(i).scrollIntoViewIfNeeded();
    const point = await slices.nth(i).evaluate(element => {
      const path = element as SVGGeometryElement;
      const box = path.getBBox();
      for (let x = 0.1; x < 1; x += 0.1) {
        for (let y = 0.1; y < 1; y += 0.1) {
          const local = new DOMPoint(box.x + box.width * x, box.y + box.height * y);
          if (path.isPointInFill(local)) {
            const screen = local.matrixTransform(path.getScreenCTM()!);
            return { x: screen.x, y: screen.y };
          }
        }
      }
      throw new Error("Slice has no filled area");
    });
    await page.mouse.move(point.x, point.y);
    await tooltip(pie, level.name, level.count);
  }
  // Sample actual painted areas so a pie with correct tooltip values but
  // equal/wrong slice angles fails too. Padding gaps allow a small tolerance.
  const areas = await slices.evaluateAll(nodes => nodes.map(node => {
    const path = node as SVGGeometryElement;
    const box = path.getBBox();
    let filled = 0;
    const steps = 80;
    for (let x = 0; x < steps; x++) {
      for (let y = 0; y < steps; y++) {
        if (path.isPointInFill(new DOMPoint(
          box.x + box.width * (x + 0.5) / steps,
          box.y + box.height * (y + 0.5) / steps,
        ))) filled++;
      }
    }
    return filled / (steps * steps) * box.width * box.height;
  }));
  const totalArea = areas.reduce((sum, area) => sum + area, 0);
  for (const [i, level] of levels.entries()) {
    expect(Math.abs(areas[i] / totalArea - level.count / 10)).toBeLessThan(0.025);
  }
  await expect(bars.locator(".recharts-yAxis .recharts-cartesian-axis-tick-value"))
    .toHaveText(dimensions.map(d => d.name));
  const rectangles = bars.locator(".recharts-bar-rectangle path");
  await expect(rectangles).toHaveCount(3);
  for (const [i, dimension] of dimensions.entries()) {
    await rectangles.nth(i).hover();
    await tooltip(bars, dimension.name, dimension.count, "count");
  }
  // Bar geometry must represent the counts, not just correctly named tooltips.
  const widths = await rectangles.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
  expect(widths[0]).toBeGreaterThan(0);
  expect(widths[1] / widths[0]).toBeCloseTo(3 / 5, 1);
  expect(widths[2] / widths[0]).toBeCloseTo(2 / 5, 1);
}

test("classification slices, legend colors, dimension labels/counts and hover tooltips", async ({ page }) => {
  await load(page);
  await assertPopulated(page);
  await page.mouse.move(0, 0);
  await expect(charts(page).bars.locator(".recharts-tooltip-wrapper")).not.toBeVisible();
});

test("keyboard users can inspect named chart tables with correctly associated counts", async ({ page }) => {
  await load(page);
  const { pie, bars } = charts(page);
  for (const [card, title, category, rows] of [
    [pie, "Classification distribution", "Classification", levels],
    [bars, "Findings by dimension", "Dimension", dimensions],
  ] as const) {
    const summary = card.locator("summary");
    await expect(summary).toHaveAccessibleName(`View ${title.toLowerCase()} values`);
    const table = card.getByRole("table", { name: `${title} values` });
    await expect(table).not.toBeVisible();
    // Start immediately before the disclosure, then reach it using Tab.
    await card.locator("details").evaluate(details => {
      const before = document.createElement("button");
      details.before(before);
      before.focus();
      before.addEventListener("blur", () => before.remove(), { once: true });
    });
    await page.keyboard.press("Tab");
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveText([category, "Count"]);
    await expect(table.getByRole("rowheader")).toHaveText(rows.map(row => row.name));
    for (const row of rows) {
      const tableRow = table.getByRole("row").filter({
        has: page.getByRole("rowheader", { name: row.name, exact: true }),
      });
      await expect(tableRow.getByRole("rowheader")).toHaveAttribute("scope", "row");
      await expect(tableRow.getByRole("cell")).toHaveText(String(row.count));
    }
    await page.keyboard.press("Space");
    await expect(table).not.toBeVisible();
    await expect(summary).toBeFocused();
  }
});

test("charts resize at narrow and wide viewports and remain interactive", async ({ page }) => {
  await load(page);
  for (const width of [768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const chart of [charts(page).pie, charts(page).bars]) {
      await chart.scrollIntoViewIfNeeded();
      await expect.poll(async () => {
        const box = await chart.locator(".recharts-wrapper").boundingBox();
        return !!box && box.width > 0 && box.height > 0 && box.x >= 0 && box.x + box.width <= width;
      }).toBe(true);
    }
    await assertPopulated(page);
  }
});

test("switching away and back remounts charts with updated assessment, including empty distributions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await load(page);
  await assertPopulated(page);
  for (const items of [
    inventory.slice(0, 2),
    inventory.slice(0, 2).map(item => ({ ...item, classification: "" })),
    [],
    inventory,
  ]) {
    await page.getByTestId("tab-evidence").click();
    await expect(page.getByText("Classification Distribution", { exact: true })).toHaveCount(0);
    await page.route("**/api/clean-core/demo", route =>
      route.fulfill({ json: { evidence: [], assessment: assessment(items) } }));
    await page.getByTestId("button-load-demo").click();
    await page.getByTestId("button-confirm-replace").click();
    await expect(page.getByText(`${items.length} SAP objects ready.`, { exact: true })).toBeVisible();
    await page.getByTestId("tab-dashboard").click();
    const { pie, bars, slices } = charts(page);
    if (items === inventory) {
      await assertPopulated(page);
      continue;
    }
    const hasClassifiedValues = items.some(item => item.classification);
    await expect(pie.getByText("No classified values to display.", { exact: true }))
      .toHaveCount(hasClassifiedValues ? 0 : 1);
    await expect(bars.getByText("No findings to display by dimension.", { exact: true }))
      .toHaveCount(items.length ? 0 : 1);
    for (const [card, name, label, hasValues] of [
      [pie, "Classification distribution values", "Level A", hasClassifiedValues],
      [bars, "Findings by dimension values", "Extensibility", items.length > 0],
    ] as const) {
      if (!hasValues) {
        await expect(card.locator("summary")).toHaveCount(0);
        continue;
      }
      await card.locator("summary").focus();
      await page.keyboard.press("Enter");
      const table = card.getByRole("table", { name });
      await expect(table.getByRole("rowheader")).toHaveText([label]);
      await expect(table.getByRole("cell")).toHaveText(["2"]);
    }
    if (!hasClassifiedValues) {
      await expect(pie.getByText("No classified values to display.", { exact: true })).toBeVisible();
      await expect(pie.locator(".recharts-surface")).toHaveCount(0);
    } else {
      await expect(pie.locator(".recharts-surface").first()).toBeVisible();
    }
    await expect(slices).toHaveCount(hasClassifiedValues ? 1 : 0);
    await expect(pie.locator(".recharts-legend-item")).toHaveText(hasClassifiedValues ? ["Level A"] : []);
    await expect(bars.locator(".recharts-bar-rectangle path")).toHaveCount(items.length ? 1 : 0);
    await expect(bars.locator(".recharts-yAxis .recharts-cartesian-axis-tick-value"))
      .toHaveText(items.length ? ["Extensibility"] : []);
    if (items.length) {
      await expect(bars.locator(".recharts-surface").first()).toBeVisible();
      if (hasClassifiedValues) await expect(slices.first()).toHaveAttribute("fill", levels[0].color);
      await bars.locator(".recharts-bar-rectangle path").hover();
      await tooltip(bars, "Extensibility", 2, "count");
    } else {
      await expect(bars.getByText("No findings to display by dimension.", { exact: true })).toBeVisible();
      await expect(bars.locator(".recharts-surface")).toHaveCount(0);
      await expect(pie.locator(".recharts-tooltip-wrapper")).not.toBeVisible();
      await expect(bars.locator(".recharts-tooltip-wrapper")).not.toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});
