import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const BASE_URL = "http://127.0.0.1:8080";
const PAGE_URL = `${BASE_URL}/license.html`;
const VIEWPORT = { width: 1920, height: 1080 };
const EXPECTED_PAGE_HEIGHT = 4231;
const MAX_DIFF_RATIO = 0.03;

const isServerReady = () => new Promise((resolve) => {
  const req = request(BASE_URL, (response) => {
    response.resume();
    resolve(response.statusCode === 200);
  });
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

  await page.goto(PAGE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  if (dimensions.width !== VIEWPORT.width || dimensions.height !== EXPECTED_PAGE_HEIGHT) throw new Error(`Неверная геометрия страницы: ${dimensions.width}×${dimensions.height}.`);

  await mkdir("artifacts", { recursive: true });
  const actualPath = "artifacts/license-actual.png";
  const diffPath = "artifacts/license-diff.png";
  await page.screenshot({ path: actualPath, fullPage: true });
  const [referenceBuffer, actualBuffer] = await Promise.all([readFile("assets/reference/figma-license.png"), readFile(actualPath)]);
  const reference = PNG.sync.read(referenceBuffer);
  const actual = PNG.sync.read(actualBuffer);
  const diff = new PNG({ width: reference.width, height: reference.height });
  const differentPixels = pixelmatch(reference.data, actual.data, diff.data, reference.width, reference.height, { threshold: 0.1 });
  await writeFile(diffPath, PNG.sync.write(diff));

  const diffRatio = differentPixels / (reference.width * reference.height);
  console.log(`License visual diff: ${(diffRatio * 100).toFixed(2)}%`);
  console.log(`Actual: ${actualPath}`);
  console.log(`Diff: ${diffPath}`);
  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  if (diffRatio > MAX_DIFF_RATIO) throw new Error(`Визуальное расхождение ${(diffRatio * 100).toFixed(2)}% превышает лимит ${MAX_DIFF_RATIO * 100}%.`);

  await page.locator(".faq-item__button").nth(1).click();
  const expandedFaq = await page.locator(".faq-item__button").nth(1).getAttribute("aria-expanded");
  if (expandedFaq !== "true") throw new Error("Аккордеон FAQ не раскрыл выбранный пункт.");

  await page.locator(".trial-form__submit").click();
  const formStatus = await page.locator(".trial-form__status").textContent();
  if (formStatus?.trim() !== "Заполните имя и телефон.") throw new Error("Форма не сообщает об обязательных полях.");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PAGE_URL, { waitUntil: "networkidle" });
  const mobileAudit = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    brokenImages: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length,
  }));
  if (mobileAudit.scrollWidth > mobileAudit.viewportWidth) throw new Error(`Горизонтальный скролл на мобильном: ${mobileAudit.scrollWidth}px.`);
  if (mobileAudit.brokenImages) throw new Error(`Не загрузились изображения: ${mobileAudit.brokenImages}.`);
  console.log("FAQ, form and 390px mobile audit: OK");
} finally {
  await browser?.close();
  server?.kill();
}
