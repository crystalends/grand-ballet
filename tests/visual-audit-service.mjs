import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const BASE_URL = "http://127.0.0.1:8080";
const PAGE_URL = `${BASE_URL}/service.html`;
const VIEWPORT = { width: 1920, height: 1080 };
const EXPECTED_PAGE_HEIGHT = 7973;
const MAX_DIFF_RATIO = 0.03;
const FOOTER_CROP = { x: 190, y: 7604, width: 1540, height: 369 };
const MAX_FOOTER_DIFF_RATIO = 0.02;

const cropPixels = (png, crop) => {
  const result = Buffer.alloc(crop.width * crop.height * 4);
  for (let row = 0; row < crop.height; row += 1) {
    const sourceStart = ((crop.y + row) * png.width + crop.x) * 4;
    const targetStart = row * crop.width * 4;
    png.data.copy(result, targetStart, sourceStart, sourceStart + crop.width * 4);
  }
  return result;
};

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

  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(PAGE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  if (dimensions.width !== VIEWPORT.width || dimensions.height !== EXPECTED_PAGE_HEIGHT) {
    throw new Error(`Неверная геометрия страницы: ${dimensions.width}×${dimensions.height}.`);
  }

  await mkdir("artifacts", { recursive: true });
  const actualPath = "artifacts/service-actual.png";
  const diffPath = "artifacts/service-diff.png";
  await page.screenshot({ path: actualPath, fullPage: true });

  const [referenceBuffer, actualBuffer] = await Promise.all([
    readFile("assets/reference/figma-service.png"),
    readFile(actualPath),
  ]);
  const reference = PNG.sync.read(referenceBuffer);
  const actual = PNG.sync.read(actualBuffer);
  const diff = new PNG({ width: reference.width, height: reference.height });
  const differentPixels = pixelmatch(reference.data, actual.data, diff.data, reference.width, reference.height, { threshold: 0.1 });
  await writeFile(diffPath, PNG.sync.write(diff));

  const diffRatio = differentPixels / (reference.width * reference.height);
  const footerDifferentPixels = pixelmatch(
    cropPixels(reference, FOOTER_CROP),
    cropPixels(actual, FOOTER_CROP),
    null,
    FOOTER_CROP.width,
    FOOTER_CROP.height,
    { threshold: 0.1 },
  );
  const footerDiffRatio = footerDifferentPixels / (FOOTER_CROP.width * FOOTER_CROP.height);
  console.log(`Service visual diff: ${(diffRatio * 100).toFixed(2)}%`);
  console.log(`Footer visual diff: ${(footerDiffRatio * 100).toFixed(2)}%`);
  console.log(`Actual: ${actualPath}`);
  console.log(`Diff: ${diffPath}`);

  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  if (diffRatio > MAX_DIFF_RATIO) throw new Error(`Визуальное расхождение ${(diffRatio * 100).toFixed(2)}% превышает лимит ${MAX_DIFF_RATIO * 100}%.`);
  if (footerDiffRatio > MAX_FOOTER_DIFF_RATIO) throw new Error(`Расхождение footer ${(footerDiffRatio * 100).toFixed(2)}% превышает лимит ${MAX_FOOTER_DIFF_RATIO * 100}%.`);

  const teachersCarousel = page.locator(".teachers__viewport");
  if (await teachersCarousel.getAttribute("role") !== "region" || await teachersCarousel.getAttribute("aria-roledescription") !== "карусель") {
    throw new Error("Карусель педагогов не получила доступную семантику.");
  }
  if (!await page.locator(".teachers__arrow--previous").isDisabled()) {
    throw new Error("Предыдущая стрелка должна быть отключена на первом слайде.");
  }
  await page.locator(".teachers__arrow--next").click();
  await page.waitForTimeout(400);
  if (await teachersCarousel.evaluate((node) => node.swiper?.activeIndex ?? 0) < 1) {
    throw new Error("Карусель педагогов не переключает активный слайд.");
  }

  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    const footerLayout = await page.locator(".site-footer").evaluate((footer) => {
      const brand = footer.querySelector(".site-footer__brand").getBoundingClientRect();
      const columns = footer.querySelector(".site-footer__columns").getBoundingClientRect();
      return {
        clientWidth: footer.clientWidth,
        scrollWidth: footer.scrollWidth,
        fontSize: getComputedStyle(footer).fontSize,
        brandRight: brand.right,
        columnsLeft: columns.left,
      };
    });
    if (footerLayout.scrollWidth !== footerLayout.clientWidth) {
      throw new Error(`Footer выходит за границы на ширине ${width}px.`);
    }
    if (footerLayout.fontSize !== "16px") {
      throw new Error(`Размер текста footer изменился на ширине ${width}px.`);
    }
    if (width === 1440 && footerLayout.columnsLeft - footerLayout.brandRight < 40) {
      throw new Error("Между логотипом и колонками footer недостаточный отступ на ширине 1440px.");
    }
  }
} finally {
  await browser?.close();
  server?.kill();
}
