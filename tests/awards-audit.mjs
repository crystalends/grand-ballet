import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const BASE_URL = "http://127.0.0.1:8080";
const VIEWPORT = { width: 1920, height: 1080 };
const EXPECTED_PAGE_HEIGHT = 5005;
const MAX_DIFF_RATIO = 0.02;

const expectedSections = {
  ".site-header": { x: 190, y: 0, width: 1540, height: 131 },
  ".awards-hero": { x: 190, y: 141, width: 1540, height: 315 },
  ".awards-summary": { x: 190, y: 556, width: 1540, height: 380 },
  ".awards-gallery": { x: 190, y: 1036, width: 1540, height: 2032 },
  ".faq": { x: 190, y: 3168, width: 1540, height: 542 },
  ".seo-copy": { x: 190, y: 3810, width: 1540, height: 208 },
  ".trial": { x: 190, y: 4118, width: 1540, height: 478 },
  ".site-footer": { x: 190, y: 4636, width: 1540, height: 369 },
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

const differs = (actual, expected) => Object.entries(expected)
  .some(([key, value]) => Math.abs(actual[key] - value) > .1);

let server;
let browser;

try {
  if (!await isServerReady()) {
    server = spawn("python3", ["-m", "http.server", "8080"], { stdio: "ignore" });
    await waitForServer();
  }

  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(`${BASE_URL}/awards.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  if (dimensions.width !== VIEWPORT.width || dimensions.height !== EXPECTED_PAGE_HEIGHT) {
    throw new Error(`Неверная геометрия страницы: ${dimensions.width}×${dimensions.height}.`);
  }

  for (const [selector, expected] of Object.entries(expectedSections)) {
    const actual = await page.locator(selector).boundingBox();
    if (!actual || differs(actual, expected)) throw new Error(`${selector} расположен не по Figma: ${JSON.stringify(actual)}.`);
  }

  const certificates = page.locator(".awards-gallery__image");
  if (await certificates.count() !== 15) throw new Error("В галерее должно быть 15 дипломов.");
  const firstCertificate = await certificates.first().boundingBox();
  const lastCertificate = await certificates.last().boundingBox();
  if (!firstCertificate || differs(firstCertificate, { x: 190, y: 1036, width: 370, height: 493 })) throw new Error("Первый диплом расположен не по Figma.");
  if (!lastCertificate || differs(lastCertificate, { x: 970, y: 2575, width: 370, height: 493 })) throw new Error("Последний диплом расположен не по Figma.");

  await mkdir("artifacts", { recursive: true });
  const actualPath = "artifacts/awards-actual.png";
  const diffPath = "artifacts/awards-diff.png";
  await page.screenshot({ path: actualPath, fullPage: true });
  const [referenceBuffer, actualBuffer] = await Promise.all([
    readFile("assets/reference/figma-awards.png"),
    readFile(actualPath),
  ]);
  const reference = PNG.sync.read(referenceBuffer);
  const actual = PNG.sync.read(actualBuffer);
  const diff = new PNG({ width: reference.width, height: reference.height });
  const differentPixels = pixelmatch(reference.data, actual.data, diff.data, reference.width, reference.height, { threshold: .1 });
  await writeFile(diffPath, PNG.sync.write(diff));
  const diffRatio = differentPixels / (reference.width * reference.height);
  console.log(`Awards visual diff: ${(diffRatio * 100).toFixed(2)}%`);
  console.log(`Actual: ${actualPath}`);
  console.log(`Diff: ${diffPath}`);
  if (diffRatio > MAX_DIFF_RATIO) throw new Error(`Визуальное расхождение ${(diffRatio * 100).toFixed(2)}% превышает лимит ${MAX_DIFF_RATIO * 100}%.`);

  const secondQuestion = page.locator(".faq-item").nth(1);
  await secondQuestion.locator(".faq-item__button").click();
  if (await secondQuestion.locator(".faq-item__button").getAttribute("aria-expanded") !== "true") throw new Error("FAQ не раскрывается.");

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileGeometry = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    overflow: Array.from(document.querySelectorAll("body *"))
      .map((element) => ({ selector: element.className || element.tagName, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width }))
      .filter((item) => item.right > window.innerWidth + .5)
      .slice(0, 8),
  }));
  if (mobileGeometry.width !== mobileGeometry.viewport) throw new Error(`На мобильной ширине появился горизонтальный скролл: ${JSON.stringify(mobileGeometry)}.`);
  if (!await certificates.first().evaluate((image) => image.complete && image.naturalWidth > 0)) throw new Error("Изображение диплома не загрузилось.");
  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
} finally {
  await browser?.close();
  server?.kill();
}
