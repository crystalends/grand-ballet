import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const PAGE_URL = "http://127.0.0.1:8080";
const VIEWPORT = { width: 1920, height: 1080 };
const MIN_PAGE_HEIGHT = 9529;
const STABLE_REFERENCE_HEIGHT = 6947;
const MAX_DIFF_RATIO = 0.03;

const isServerReady = () => new Promise((resolve) => {
  const req = request(PAGE_URL, (response) => {
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

const getExecutablePath = () => process.env.BROWSER_EXECUTABLE_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let server;
let browser;

try {
  if (!await isServerReady()) {
    server = spawn("python3", ["-m", "http.server", "8080"], { stdio: "ignore" });
    await waitForServer();
  }

  browser = await chromium.launch({ executablePath: getExecutablePath(), headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(PAGE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  if (dimensions.width !== VIEWPORT.width || dimensions.height < MIN_PAGE_HEIGHT) {
    throw new Error(`Неверная геометрия страницы: ${dimensions.width}×${dimensions.height}.`);
  }

  await mkdir("artifacts", { recursive: true });
  const actualPath = "artifacts/directions-actual.png";
  const diffPath = "artifacts/directions-diff.png";
  await page.screenshot({ path: actualPath, fullPage: true });

  const [referenceBuffer, actualBuffer] = await Promise.all([
    readFile("assets/reference/figma-directions.png"),
    readFile(actualPath),
  ]);
  const reference = PNG.sync.read(referenceBuffer);
  const actual = PNG.sync.read(actualBuffer);
  if (reference.width !== actual.width
    || reference.height < STABLE_REFERENCE_HEIGHT
    || actual.height < STABLE_REFERENCE_HEIGHT) {
    throw new Error(`Недостаточный размер для визуального сравнения: reference=${reference.width}×${reference.height}, actual=${actual.width}×${actual.height}.`);
  }
  const referenceStable = new PNG({ width: reference.width, height: STABLE_REFERENCE_HEIGHT });
  const actualStable = new PNG({ width: actual.width, height: STABLE_REFERENCE_HEIGHT });
  PNG.bitblt(reference, referenceStable, 0, 0, reference.width, STABLE_REFERENCE_HEIGHT, 0, 0);
  PNG.bitblt(actual, actualStable, 0, 0, actual.width, STABLE_REFERENCE_HEIGHT, 0, 0);
  const diff = new PNG({ width: reference.width, height: STABLE_REFERENCE_HEIGHT });
  const differentPixels = pixelmatch(
    referenceStable.data,
    actualStable.data,
    diff.data,
    reference.width,
    STABLE_REFERENCE_HEIGHT,
    { threshold: 0.1 },
  );
  await writeFile(diffPath, PNG.sync.write(diff));

  const diffRatio = differentPixels / (reference.width * STABLE_REFERENCE_HEIGHT);
  console.log(`Visual diff: ${(diffRatio * 100).toFixed(2)}%`);
  console.log(`Actual: ${actualPath}`);
  console.log(`Diff: ${diffPath}`);

  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  if (diffRatio > MAX_DIFF_RATIO) {
    throw new Error(`Визуальное расхождение ${(diffRatio * 100).toFixed(2)}% превышает лимит ${MAX_DIFF_RATIO * 100}%.`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  const mobileWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  if (mobileWidth.scroll !== mobileWidth.client) {
    throw new Error(`Горизонтальный скролл на 390px: ${mobileWidth.scroll}px при viewport ${mobileWidth.client}px.`);
  }

} finally {
  await browser?.close();
  server?.kill();
}
