import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const BASE_URL = "http://127.0.0.1:8080";
const VIEWPORT = { width: 1920, height: 1080 };
const MIN_PAGE_HEIGHT = 3507;
const STABLE_REFERENCE_HEIGHT = 1997;
const MAX_DIFF_RATIO = 0.035;
const expectedSections = {
  ".site-header": { x: 190, y: 0, width: 1540, height: 131 },
  ".news-detail-hero": { x: 190, y: 151, width: 1540, height: 367 },
  ".news-article": { x: 190, y: 578, width: 1150, height: 832 },
  ".news-gallery": { x: 190, y: 1510, width: 1540, height: 387 },
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
  await page.goto(`${BASE_URL}/news-detail.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  if (dimensions.width !== VIEWPORT.width || dimensions.height < MIN_PAGE_HEIGHT) throw new Error(`Неверная геометрия страницы: ${dimensions.width}×${dimensions.height}.`);
  for (const [selector, expected] of Object.entries(expectedSections)) {
    const actual = await page.locator(selector).boundingBox();
    if (!actual || differs(actual, expected)) throw new Error(`${selector} расположен не по Figma: ${JSON.stringify(actual)}.`);
  }

  if (await page.locator(".news-gallery .director-gallery__image").count() !== 3) throw new Error("В фотогалерее должно быть три изображения из Figma.");
  if (await page.locator(".news-related .news-card").count() !== 3) throw new Error("В связанных новостях должно быть три карточки.");
  if (await page.locator(".news-article__point").count() !== 4) throw new Error("В статье должно быть четыре смысловых пункта.");
  if (await page.locator(".news-article__list li").count() !== 6) throw new Error("В программе должно быть шесть пунктов.");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-carousel-viewport]")].every((viewport) => viewport.classList.contains("swiper-initialized")));
  const relatedState = await page.locator(".news-related").evaluate((section) => ({
    y: Math.round(section.getBoundingClientRect().y),
    height: Math.round(section.getBoundingClientRect().height),
    clippedDescriptions: [...section.querySelectorAll(".news-card__description")]
      .filter((description) => description.scrollHeight > description.clientHeight + 2).length,
  }));
  if (relatedState.y !== 1997 || relatedState.height < 523 || relatedState.clippedDescriptions) throw new Error(`Связанные новости не растут по контенту: ${JSON.stringify(relatedState)}.`);

  await mkdir("artifacts", { recursive: true });
  const actualPath = "artifacts/news-detail-actual.png";
  const diffPath = "artifacts/news-detail-diff.png";
  await page.screenshot({ path: actualPath, fullPage: true });
  const [referenceBuffer, actualBuffer] = await Promise.all([readFile("assets/reference/figma-news-detail.png"), readFile(actualPath)]);
  const reference = PNG.sync.read(referenceBuffer);
  const actual = PNG.sync.read(actualBuffer);
  if (reference.width !== actual.width || reference.height < STABLE_REFERENCE_HEIGHT || actual.height < STABLE_REFERENCE_HEIGHT) throw new Error(`Размер снимка ${actual.width}×${actual.height} недостаточен для сравнения с Figma ${reference.width}×${reference.height}.`);
  const referenceStable = new PNG({ width: reference.width, height: STABLE_REFERENCE_HEIGHT });
  const actualStable = new PNG({ width: actual.width, height: STABLE_REFERENCE_HEIGHT });
  PNG.bitblt(reference, referenceStable, 0, 0, reference.width, STABLE_REFERENCE_HEIGHT, 0, 0);
  PNG.bitblt(actual, actualStable, 0, 0, actual.width, STABLE_REFERENCE_HEIGHT, 0, 0);
  const diff = new PNG({ width: reference.width, height: STABLE_REFERENCE_HEIGHT });
  const differentPixels = pixelmatch(referenceStable.data, actualStable.data, diff.data, reference.width, STABLE_REFERENCE_HEIGHT, { threshold: .1 });
  await writeFile(diffPath, PNG.sync.write(diff));
  const diffRatio = differentPixels / (reference.width * STABLE_REFERENCE_HEIGHT);
  console.log(`News detail visual diff: ${(diffRatio * 100).toFixed(2)}%`);
  if (diffRatio > MAX_DIFF_RATIO) throw new Error(`Визуальное расхождение ${(diffRatio * 100).toFixed(2)}% превышает лимит ${MAX_DIFF_RATIO * 100}%.`);

  await page.locator(".trial-form__submit").click();
  if ((await page.locator(".trial-form__status").textContent())?.trim() !== "Заполните имя и телефон.") throw new Error("Не работает валидация формы.");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/news-detail.html`, { waitUntil: "networkidle" });
  const mobile = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, broken: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length }));
  if (mobile.scroll > mobile.viewport) throw new Error(`Горизонтальный скролл на мобильном: ${mobile.scroll}px.`);
  if (mobile.broken) throw new Error(`Не загрузились изображения: ${mobile.broken}.`);
  const menuToggle = page.locator(".site-header__menu-toggle");
  await menuToggle.click();
  if (await menuToggle.getAttribute("aria-expanded") !== "true") throw new Error("Мобильное меню не открывается.");
  await page.keyboard.press("Escape");

  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  console.log("News detail geometry, visual, carousels, form and 390px mobile audit: OK");
  console.log(`Actual: ${actualPath}`);
  console.log(`Diff: ${diffPath}`);
} finally {
  await browser?.close();
  server?.kill();
}
