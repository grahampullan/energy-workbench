import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
});

async function openExample(page, example) {
  await page.goto(`/?example=${example}`);
  await expect(page.locator("#run-status")).toHaveClass(/run-status--complete/u);
  await expect(page.locator(".connection-line").first()).toHaveAttribute("x1", /\d/u);
}

async function loadModel(page, model, name = "modified-model.json") {
  await page.locator("#open-model-file").setInputFiles({
    name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model))
  });
  await expect(page.locator("#document-status")).toHaveText(`Loaded ${name}`);
}

test("select, preview, reset, apply, save and reload a working model", async ({ page }) => {
  await openExample(page, "blog-electrical");
  await page.getByRole("button", { name: /^Solar PV,/u }).click();
  const numeric = page.getByRole("spinbutton", { name: "Profile multiplier numeric value", exact: true });
  const slider = page.getByRole("slider", { name: "Profile multiplier slider", exact: true });
  await expect(numeric).toHaveValue("1");
  await numeric.fill("0.5");
  await expect(slider).toHaveValue("0.5");
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Reset preview", exact: true }).click();
  await expect(numeric).toHaveValue("1");
  await expect(page.locator("#run-status")).toHaveClass(/run-status--complete/u);

  await numeric.fill("0.5");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#run-status")).toHaveClass(/run-status--complete/u);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save model", exact: true }).click();
  const download = await downloadPromise;
  const saved = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(saved.components.find(({ id }) => id === "pv").parameters.profileMultiplier).toBe(0.5);

  await numeric.fill("1.5");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(numeric).toHaveValue("1.5");
  await loadModel(page, saved, "saved-model.json");
  await expect(numeric).toHaveValue("0.5");
  await expect(slider).toHaveValue("0.5");
  await expect(page.locator("#run-status")).toHaveClass(/run-status--complete/u);
});

test("model reload updates connection identities, colours, arrows and hover together", async ({ page }) => {
  await openExample(page, "blog-electrical");
  const model = JSON.parse(await readFile(
    new URL("../examples/blog-electrical/model.json", import.meta.url), "utf8"
  ));
  const oldId = model.connections[0].id;
  model.connections[0].id = "renamed-grid-link";
  model.connections.reverse();
  await loadModel(page, model);
  await page.locator("#results-chart svg").press("Home");
  const line = page.locator('.connection-line[data-connection-id="renamed-grid-link"]');
  await expect(line).toHaveCount(1);
  await expect(page.locator(`.connection-line[data-connection-id="${oldId}"]`)).toHaveCount(0);
  await expect(page.locator("marker.flow-arrow")).toHaveCount(model.connections.length);

  // A timestep with non-zero power exercises the arrow as well as the line.
  for (const connection of model.connections) {
    await expect.poll(async () => page.evaluate((id) => {
      const line = document.querySelector(`.connection-line[data-connection-id="${id}"]`);
      const series = [...document.querySelectorAll(".results-chart-lines path")]
        .filter((path) => path.dataset.seriesId?.startsWith(`${id}:`));
      const colour = getComputedStyle(line).stroke;
      const marker = line.getAttribute("marker-end") || line.getAttribute("marker-start");
      const arrow = marker && document.querySelector(marker.slice(4, -1));
      return series.length > 0 && series.every((path) => getComputedStyle(path).stroke === colour) &&
        (!arrow || getComputedStyle(arrow.querySelector("path")).fill === colour);
    }, connection.id)).toBe(true);
  }
  await expect(line).toHaveAttribute("marker-end", /url\(#flow-arrow-/u);
  await page.locator('.connection-hit[data-connection-id="renamed-grid-link"]').dispatchEvent("pointerenter");
  await expect(line).toHaveClass(/connection-line--highlighted/u);
  await expect(page.locator('.component-card[data-highlighted="true"]')).toHaveCount(2);

  await loadModel(page, { ...model, connections: [...model.connections].reverse() }, "reordered-model.json");
  await expect(page.locator("marker.flow-arrow")).toHaveCount(model.connections.length);
  await expect(page.locator("marker.flow-arrow path")).toHaveCount(model.connections.length);
});

for (const example of [
  "coupled-thermal", "batch-heating-synthetic", "material-inventory-synthetic",
  "ladle-cycle-historical", "ladle-cycle-minimum-fuel"
]) {
  test(`${example} runs and renders initial temperature and component equations`, async ({ page }) => {
    await openExample(page, example);
    await page.locator("#show-temperature-chart").click();
    await expect.poll(() => page.locator(".results-chart-lines path").evaluateAll((paths) =>
      paths.length > 0 && paths.every((path) => path.__data__.values[0].elapsedSeconds === 0)
    )).toBe(true);
    await page.locator(".component-card").first().click();
    await page.getByRole("button", { name: "Equations", exact: true }).click();
    await expect(page.locator(".katex").first()).toBeVisible();
  });
}
