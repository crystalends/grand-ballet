import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const PAGE_URL = "http://127.0.0.1:8080";
const EXPECTED_SIZE = { width: 1540, height: 232 };
const MAX_DIFF_RATIO = 0.025;

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

const executablePath = process.env.BROWSER_EXECUTABLE_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let server;
let browser;

try {
  if (!await isServerReady()) {
    server = spawn("python3", ["-m", "http.server", "8080"], { stdio: "ignore" });
    await waitForServer();
  }

  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(PAGE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const reviews = page.locator(".reviews__viewport");
  const box = await reviews.boundingBox();
  if (!box || box.width !== EXPECTED_SIZE.width || box.height !== EXPECTED_SIZE.height) {
    throw new Error(`Неверная геометрия отзывов: ${box?.width}×${box?.height}.`);
  }

  await mkdir("artifacts", { recursive: true });
  const actualPath = "artifacts/reviews-actual.png";
  const diffPath = "artifacts/reviews-diff.png";
  await reviews.screenshot({ path: actualPath, animations: "disabled" });

  const [referenceBuffer, actualBuffer] = await Promise.all([
    readFile("assets/reference/figma-reviews.png"),
    readFile(actualPath),
  ]);
  const reference = PNG.sync.read(referenceBuffer);
  const actual = PNG.sync.read(actualBuffer);
  const diff = new PNG({ width: reference.width, height: reference.height });
  const differentPixels = pixelmatch(
    reference.data,
    actual.data,
    diff.data,
    reference.width,
    reference.height,
    { threshold: 0.2 },
  );
  await writeFile(diffPath, PNG.sync.write(diff));

  const diffRatio = differentPixels / (reference.width * reference.height);
  console.log(`Reviews visual diff: ${(diffRatio * 100).toFixed(2)}%`);

  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  if (diffRatio > MAX_DIFF_RATIO) {
    throw new Error(`Расхождение отзывов ${(diffRatio * 100).toFixed(2)}% превышает лимит ${MAX_DIFF_RATIO * 100}%.`);
  }
} finally {
  await browser?.close();
  server?.kill();
}
