import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";

const BASE_URL = "http://127.0.0.1:8080";
const PAGE_URL = `${BASE_URL}/privacy.html`;

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

const expectedSections = [
  [".site-header", 0, 190, 1540],
  [".privacy-heading", 141, 190, 1540],
  [".privacy-article", 310, 190, 1540],
  [".privacy-article__content", 310, 190, 1150],
  [".site-footer", 2436, 190, 1540],
];

let server;
let browser;

try {
  if (!await isServerReady()) {
    server = spawn("python3", ["-m", "http.server", "8080"], { stdio: "ignore" });
    await waitForServer();
  }

  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(PAGE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const pageSize = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  if (pageSize.width !== 1920 || pageSize.height !== 2805) throw new Error(`Неверная геометрия страницы: ${pageSize.width}×${pageSize.height}.`);

  for (const [selector, top, left, width] of expectedSections) {
    const box = await page.locator(selector).boundingBox();
    if (!box || Math.abs(box.y - top) > 1 || Math.abs(box.x - left) > 1 || Math.abs(box.width - width) > 1) {
      throw new Error(`${selector}: ожидалось x=${left}, y=${top}, w=${width}; получено ${JSON.stringify(box)}.`);
    }
  }

  const overflow = await page.locator(".privacy-article").evaluate((node) => node.scrollHeight > node.clientHeight);
  if (overflow) throw new Error("Текст выходит за границы контейнера статьи.");

  const desktopBroken = await page.evaluate(() => [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length);
  if (desktopBroken) throw new Error(`Не загрузились изображения: ${desktopBroken}.`);

  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/privacy-actual.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PAGE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const mobile = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    broken: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length,
  }));
  if (mobile.scroll > mobile.viewport) {
    const offenders = await page.evaluate(() => [...document.querySelectorAll("body, body *")]
      .map((node) => ({ selector: `${node.tagName.toLowerCase()}.${node.className}`, left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }))
      .filter(({ left, right, scrollWidth, clientWidth }) => left < -1 || right > document.documentElement.clientWidth + 1 || scrollWidth > clientWidth + 1)
      .slice(0, 8));
    throw new Error(`Горизонтальный скролл на мобильном: ${mobile.scroll}px. Элементы: ${JSON.stringify(offenders)}`);
  }
  if (mobile.broken) throw new Error(`Не загрузились изображения на мобильном: ${mobile.broken}.`);
  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);

  console.log("Privacy page geometry, independent containers and mobile audit: OK");
  console.log("Actual: artifacts/privacy-actual.png");
} finally {
  await browser?.close();
  server?.kill();
}
