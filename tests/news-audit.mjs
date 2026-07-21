import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const BASE_URL = "http://127.0.0.1:8080";
const VIEWPORT = { width: 1920, height: 1080 };
const EXPECTED_PAGE_HEIGHT = 4598;
const MAX_DIFF_RATIO = 0.02;
const expectedSections = {
  ".site-header": { x: 190, y: 0, width: 1540, height: 131 },
  ".news-hero": { x: 190, y: 141, width: 1540, height: 215 },
  ".news-directory": { x: 190, y: 456, width: 1540, height: 2205 },
  ".faq": { x: 190, y: 2761, width: 1540, height: 542 },
  ".seo-copy": { x: 190, y: 3403, width: 1540, height: 208 },
  ".trial": { x: 190, y: 3711, width: 1540, height: 478 },
  ".site-footer": { x: 190, y: 4229, width: 1540, height: 369 },
};

const isServerReady = () => new Promise((resolve) => {
  const req = request(BASE_URL, (response) => { response.resume(); resolve(response.statusCode === 200); });
  req.on("error", () => resolve(false));
  req.end();
});

const waitForServer = async () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isServerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Локальный сервер не запустился на порту 8080.");
};

const differs = (actual, expected) => Object.entries(expected).some(([key, value]) => Math.abs(actual[key] - value) > .1);

let server;
let browser;
try {
  if (!await isServerReady()) {
    server = spawn("python3", ["-m", "http.server", "8080"], { stdio: "ignore" });
    await waitForServer();
  }
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(`${BASE_URL}/news.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  if (dimensions.width !== VIEWPORT.width || dimensions.height !== EXPECTED_PAGE_HEIGHT) throw new Error(`Неверная геометрия страницы: ${dimensions.width}×${dimensions.height}.`);
  for (const [selector, expected] of Object.entries(expectedSections)) {
    const actual = await page.locator(selector).boundingBox();
    if (!actual || differs(actual, expected)) throw new Error(`${selector} расположен не по Figma: ${JSON.stringify(actual)}.`);
  }

  const cards = page.locator(".news-directory .news-card");
  if (await cards.count() !== 15) throw new Error("В каталоге должно быть 15 карточек новостей.");
  const firstCard = await cards.first().boundingBox();
  const lastCard = await cards.last().boundingBox();
  if (!firstCard || differs(firstCard, { x: 190, y: 456, width: 500, height: 425 })) throw new Error("Первая карточка расположена не по Figma.");
  if (!lastCard || differs(lastCard, { x: 1230, y: 2236, width: 500, height: 425 })) throw new Error("Последняя карточка расположена не по Figma.");

  await mkdir("artifacts", { recursive: true });
  const actualPath = "artifacts/news-actual.png";
  const diffPath = "artifacts/news-diff.png";
  await page.screenshot({ path: actualPath, fullPage: true });
  const [referenceBuffer, actualBuffer] = await Promise.all([readFile("assets/reference/figma-news.png"), readFile(actualPath)]);
  const reference = PNG.sync.read(referenceBuffer);
  const actual = PNG.sync.read(actualBuffer);
  const diff = new PNG({ width: reference.width, height: reference.height });
  const differentPixels = pixelmatch(reference.data, actual.data, diff.data, reference.width, reference.height, { threshold: .1 });
  await writeFile(diffPath, PNG.sync.write(diff));
  const diffRatio = differentPixels / (reference.width * reference.height);
  console.log(`News visual diff: ${(diffRatio * 100).toFixed(2)}%`);
  if (diffRatio > MAX_DIFF_RATIO) throw new Error(`Визуальное расхождение ${(diffRatio * 100).toFixed(2)}% превышает лимит ${MAX_DIFF_RATIO * 100}%.`);

  await page.locator(".faq-item__button").nth(1).click();
  if (await page.locator(".faq-item__button").nth(1).getAttribute("aria-expanded") !== "true") throw new Error("FAQ не раскрывается.");
  await page.locator(".trial-form__submit").click();
  if ((await page.locator(".trial-form__status").textContent())?.trim() !== "Заполните имя и телефон.") throw new Error("Не работает валидация формы.");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/news.html`, { waitUntil: "networkidle" });
  const mobile = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, broken: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length }));
  if (mobile.scroll > mobile.viewport) throw new Error(`Горизонтальный скролл на мобильном: ${mobile.scroll}px.`);
  if (mobile.broken) throw new Error(`Не загрузились изображения: ${mobile.broken}.`);
  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  console.log("News geometry, cards, FAQ, form and mobile audit: OK");
  console.log(`Actual: ${actualPath}`);
  console.log(`Diff: ${diffPath}`);
} finally {
  await browser?.close();
  server?.kill();
}
