import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";

const BASE_URL = "http://127.0.0.1:8080";
const PAGE_URL = `${BASE_URL}/halls.html`;
const VIEWPORT = { width: 1920, height: 1080 };
const expected = [
  [".site-header", 0, 190, 1540],
  [".halls-hero", 141, 190, 1540],
  [".halls-overview", 551, 190, 1540],
  [".location-card:not(.location-card--reverse)", 1083, 190, 1540],
  [".location-card--reverse", 1772, 190, 1540],
  [".hall-equipment", 2461, 190, 1540],
  [".hall-gallery", 3146, 150, 1620],
  [".hall-gallery__inner", 3146, 190, 1540],
  [".halls-faq", 4285, 190, 1540],
  [".halls-seo", 4927, 190, 1540],
  [".trial", 5235, 190, 1540],
  [".site-footer", 5753, 190, 1540],
];

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

let server;
let browser;
try {
  if (!await isServerReady()) { server = spawn("python3", ["-m", "http.server", "8080"], { stdio: "ignore" }); await waitForServer(); }
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(PAGE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  if (size.width !== 1920 || size.height !== 6122) throw new Error(`Неверная геометрия страницы: ${size.width}×${size.height}.`);
  for (const [selector, top, left, width] of expected) {
    const box = await page.locator(selector).first().boundingBox();
    if (!box || Math.abs(box.y - top) > 1 || Math.abs(box.x - left) > 1 || Math.abs(box.width - width) > 1) throw new Error(`${selector}: ожидалось x=${left}, y=${top}, w=${width}; получено ${JSON.stringify(box)}.`);
  }
  const firstPhoto = await page.locator(".hall-photo").first().boundingBox();
  if (!firstPhoto || Math.abs(firstPhoto.x - 190) > 1) throw new Error("Фотографии галереи не выровнены по основному контейнеру.");
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/halls-actual.png", fullPage: true });
  await page.locator(".hall-gallery__row").first().locator(".hall-gallery__arrow--next").click();
  await page.waitForTimeout(400);
  if (await page.locator(".hall-gallery__viewport").first().evaluate((node) => node.swiper?.activeIndex ?? 0) < 1) throw new Error("Галерея не переключает активный слайд.");
  await page.locator(".faq-item__button").nth(1).click();
  if (await page.locator(".faq-item__button").nth(1).getAttribute("aria-expanded") !== "true") throw new Error("FAQ не раскрывается.");
  await page.locator(".trial-form__submit").click();
  if ((await page.locator(".trial-form__status").textContent())?.trim() !== "Заполните имя и телефон.") throw new Error("Не работает валидация формы.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PAGE_URL, { waitUntil: "networkidle" });
  const mobile = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, broken: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length }));
  if (mobile.scroll > mobile.viewport) throw new Error(`Горизонтальный скролл на мобильном: ${mobile.scroll}px.`);
  if (mobile.broken) throw new Error(`Не загрузились изображения: ${mobile.broken}.`);
  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  console.log("Halls geometry, containers, galleries, FAQ, form and mobile audit: OK");
  console.log("Actual: artifacts/halls-actual.png");
} finally {
  await browser?.close();
  server?.kill();
}
