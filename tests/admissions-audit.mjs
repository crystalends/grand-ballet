import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const BASE_URL = "http://127.0.0.1:8080";
const VIEWPORT = { width: 1920, height: 1080 };
const EXPECTED_PAGE_HEIGHT = 6752;
const MAX_DIFF_RATIO = 0.035;
const expectedSections = {
  ".college-header": { x: 190, y: 0, width: 1540, height: 126 },
  ".admissions-hero": { x: 190, y: 136, width: 1540, height: 339 },
  ".college-path--admissions": { x: 190, y: 575, width: 1540, height: 536 },
  ".college-programs": { x: 190, y: 1211, width: 1540, height: 348 },
  ".college-admission": { x: 190, y: 1659, width: 1540, height: 782 },
  ".admissions-documents": { x: 190, y: 2541, width: 1540, height: 643 },
  ".admissions-assessment": { x: 190, y: 3284, width: 1540, height: 330 },
  ".college-preparation": { x: 190, y: 3714, width: 1540, height: 491 },
  ".college-trust": { x: 190, y: 4305, width: 1540, height: 530 },
  ".faq": { x: 190, y: 4935, width: 1540, height: 542 },
  ".seo-copy": { x: 190, y: 5577, width: 1540, height: 208 },
  ".trial": { x: 190, y: 5885, width: 1540, height: 478 },
  ".college-footer": { x: 190, y: 6403, width: 1540, height: 349 },
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
  await page.goto(`${BASE_URL}/admissions.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  if (dimensions.width !== VIEWPORT.width || dimensions.height !== EXPECTED_PAGE_HEIGHT) throw new Error(`Неверная геометрия страницы: ${dimensions.width}×${dimensions.height}.`);
  for (const [selector, expected] of Object.entries(expectedSections)) {
    const actual = await page.locator(selector).boundingBox();
    if (!actual || differs(actual, expected)) throw new Error(`${selector} расположен не по Figma: ${JSON.stringify(actual)}.`);
  }

  if (await page.locator(".college-path--admissions .college-principle").count() !== 4) throw new Error("В блоке аудитории должно быть четыре карточки.");
  if (await page.locator(".college-program").count() !== 2) throw new Error("Должно быть две образовательные программы.");
  if (await page.locator(".college-admission .admission-step").count() !== 6) throw new Error("Должно быть шесть этапов поступления.");
  if (await page.locator(".admissions-documents__list li").count() !== 8) throw new Error("В перечне должно быть восемь документов.");
  if (await page.locator(".admissions-assessment .lesson-card").count() !== 4) throw new Error("В оценке вступительного этапа должно быть четыре критерия.");
  if (await page.locator(".college-trust-card").count() !== 4) throw new Error("В результате обучения должно быть четыре карточки.");

  await mkdir("artifacts", { recursive: true });
  const actualPath = "artifacts/admissions-actual.png";
  const diffPath = "artifacts/admissions-diff.png";
  await page.screenshot({ path: actualPath, fullPage: true });
  const [referenceBuffer, actualBuffer] = await Promise.all([readFile("assets/reference/figma-admissions.png"), readFile(actualPath)]);
  const reference = PNG.sync.read(referenceBuffer);
  const actual = PNG.sync.read(actualBuffer);
  if (reference.width !== actual.width || reference.height !== actual.height) throw new Error(`Размер снимка ${actual.width}×${actual.height} не совпал с Figma ${reference.width}×${reference.height}.`);
  const diff = new PNG({ width: reference.width, height: reference.height });
  const differentPixels = pixelmatch(reference.data, actual.data, diff.data, reference.width, reference.height, { threshold: .1 });
  await writeFile(diffPath, PNG.sync.write(diff));
  const diffRatio = differentPixels / (reference.width * reference.height);
  console.log(`Admissions visual diff: ${(diffRatio * 100).toFixed(2)}%`);
  if (diffRatio > MAX_DIFF_RATIO) throw new Error(`Визуальное расхождение ${(diffRatio * 100).toFixed(2)}% превышает лимит ${MAX_DIFF_RATIO * 100}%.`);

  await page.locator(".faq-item__button").nth(1).click();
  if (await page.locator(".faq-item__button").nth(1).getAttribute("aria-expanded") !== "true") throw new Error("FAQ не раскрывается.");
  await page.locator(".trial-form__submit").click();
  if ((await page.locator(".trial-form__status").textContent())?.trim() !== "Заполните имя и телефон.") throw new Error("Не работает валидация формы.");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/admissions.html`, { waitUntil: "networkidle" });
  const mobile = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, broken: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length }));
  if (mobile.scroll > mobile.viewport) throw new Error(`Горизонтальный скролл на мобильном: ${mobile.scroll}px.`);
  if (mobile.broken) throw new Error(`Не загрузились изображения: ${mobile.broken}.`);
  const menuToggle = page.locator(".college-header__menu-toggle");
  await menuToggle.click();
  if (await menuToggle.getAttribute("aria-expanded") !== "true") throw new Error("Мобильное меню не открывается.");
  await page.keyboard.press("Escape");

  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  console.log("Admissions geometry, visual, FAQ, form and 390px mobile audit: OK");
  console.log(`Actual: ${actualPath}`);
  console.log(`Diff: ${diffPath}`);
} finally {
  await browser?.close();
  server?.kill();
}
