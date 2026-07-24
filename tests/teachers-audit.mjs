import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const BASE_URL = "http://127.0.0.1:8080";
const VIEWPORT = { width: 1920, height: 1080 };
const MAX_DIFF_RATIO = 0.035;

const pageVariants = [
  {
    name: "college-teachers",
    file: "college-teachers.html",
    reference: "assets/reference/figma-college-teachers.png",
    expectedPageHeight: 7280,
    menu: { toggle: ".college-header__menu-toggle", nav: ".college-header__nav" },
    firstCardY: 1057,
    lastCardY: 2608,
    sections: {
      ".college-header": { x: 190, y: 0, width: 1540, height: 126 },
      ".teachers-hero": { x: 190, y: 136, width: 1540, height: 243 },
      ".teacher-trust": { x: 190, y: 479, width: 1540, height: 380 },
      ".teacher-directory": { x: 190, y: 959, width: 1540, height: 2146 },
      ".teaching-approach": { x: 190, y: 3205, width: 1540, height: 330 },
      ".age-approach": { x: 190, y: 3635, width: 1540, height: 533 },
      ".applicant-training": { x: 190, y: 4268, width: 1540, height: 482 },
      ".benefits--teachers": { x: 190, y: 4850, width: 1540, height: 513 },
      ".faq": { x: 190, y: 5463, width: 1540, height: 542 },
      ".seo-copy": { x: 190, y: 6105, width: 1540, height: 208 },
      ".trial": { x: 210, y: 6413, width: 1540, height: 478 },
      ".college-footer": { x: 210, y: 6931, width: 1540, height: 349 },
    },
  },
  {
    name: "teachers",
    file: "teachers.html",
    reference: "assets/reference/figma-teachers.png",
    expectedPageHeight: 7405,
    menu: { toggle: ".site-header__menu-toggle", nav: ".site-header__nav" },
    firstCardY: 1062,
    lastCardY: 2613,
    sections: {
      ".site-header": { x: 190, y: 0, width: 1540, height: 131 },
      ".teachers-hero": { x: 190, y: 141, width: 1540, height: 243 },
      ".teacher-trust": { x: 190, y: 484, width: 1540, height: 380 },
      ".teacher-directory": { x: 190, y: 964, width: 1540, height: 2146 },
      ".teaching-approach": { x: 190, y: 3210, width: 1540, height: 330 },
      ".age-approach": { x: 190, y: 3640, width: 1540, height: 633 },
      ".applicant-training": { x: 190, y: 4373, width: 1540, height: 482 },
      ".benefits--teachers": { x: 190, y: 4955, width: 1540, height: 513 },
      ".faq": { x: 190, y: 5568, width: 1540, height: 542 },
      ".seo-copy": { x: 190, y: 6210, width: 1540, height: 208 },
      ".trial": { x: 190, y: 6518, width: 1540, height: 478 },
      ".site-footer": { x: 190, y: 7036, width: 1540, height: 369 },
    },
  },
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

const differs = (actual, expected) => Object.entries(expected)
  .some(([key, value]) => Math.abs(actual[key] - value) > .1);

const auditPage = async (browser, variant) => {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(`${BASE_URL}/${variant.file}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  if (dimensions.width !== VIEWPORT.width || dimensions.height !== variant.expectedPageHeight) {
    throw new Error(`${variant.file}: неверная геометрия страницы ${dimensions.width}×${dimensions.height}.`);
  }

  for (const [selector, expected] of Object.entries(variant.sections)) {
    const actual = await page.locator(selector).boundingBox();
    if (!actual || differs(actual, expected)) {
      throw new Error(`${variant.file}: ${selector} расположен не по Figma: ${JSON.stringify(actual)}.`);
    }
  }

  const cards = page.locator(".teacher-card--directory");
  if (await cards.count() !== 16) throw new Error(`${variant.file}: в каталоге должно быть 16 карточек педагогов.`);
  const firstCard = await cards.first().boundingBox();
  const lastCard = await cards.last().boundingBox();
  if (!firstCard || differs(firstCard, { x: 190, y: variant.firstCardY, width: 370, height: 497 })) {
    throw new Error(`${variant.file}: первая карточка расположена не по Figma.`);
  }
  if (!lastCard || differs(lastCard, { x: 1360, y: variant.lastCardY, width: 370, height: 497 })) {
    throw new Error(`${variant.file}: последняя карточка расположена не по Figma.`);
  }

  await mkdir("artifacts", { recursive: true });
  const actualPath = `artifacts/${variant.name}-actual.png`;
  const diffPath = `artifacts/${variant.name}-diff.png`;
  await page.screenshot({ path: actualPath, fullPage: true });
  const [referenceBuffer, actualBuffer] = await Promise.all([
    readFile(variant.reference),
    readFile(actualPath),
  ]);
  const reference = PNG.sync.read(referenceBuffer);
  const actual = PNG.sync.read(actualBuffer);
  const diff = new PNG({ width: reference.width, height: reference.height });
  const differentPixels = pixelmatch(reference.data, actual.data, diff.data, reference.width, reference.height, { threshold: .1 });
  await writeFile(diffPath, PNG.sync.write(diff));
  const diffRatio = differentPixels / (reference.width * reference.height);
  console.log(`${variant.file} visual diff: ${(diffRatio * 100).toFixed(2)}%`);
  if (diffRatio > MAX_DIFF_RATIO) {
    throw new Error(`${variant.file}: визуальное расхождение ${(diffRatio * 100).toFixed(2)}% превышает лимит ${MAX_DIFF_RATIO * 100}%.`);
  }

  await cards.first().locator(".teacher-card__trigger").click();
  if (!await page.locator(".teacher-modal").evaluate((dialog) => dialog.open)) {
    throw new Error(`${variant.file}: модалка педагога не открылась.`);
  }
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    brokenImages: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length,
  }));
  if (mobile.scroll > mobile.viewport) throw new Error(`${variant.file}: горизонтальный скролл на мобильном ${mobile.scroll}px.`);
  if (mobile.brokenImages) throw new Error(`${variant.file}: не загрузились изображения на мобильном.`);

  const menuToggle = page.locator(variant.menu.toggle);
  await menuToggle.click();
  if (await menuToggle.getAttribute("aria-expanded") !== "true" || !await page.locator(variant.menu.nav).isVisible()) {
    throw new Error(`${variant.file}: мобильное меню не открылось.`);
  }
  await page.keyboard.press("Escape");
  if (await menuToggle.getAttribute("aria-expanded") !== "false") {
    throw new Error(`${variant.file}: Escape не закрыл мобильное меню.`);
  }

  if (consoleErrors.length) throw new Error(`${variant.file}: ошибки консоли: ${consoleErrors.join(" | ")}`);
  await page.close();
};

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
  for (const variant of pageVariants) await auditPage(browser, variant);
  console.log("School and college teacher pages desktop visual, modal and 390px mobile audit: OK");
} finally {
  await browser?.close();
  server?.kill();
}
