import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";

const PAGE_URL = "http://127.0.0.1:8080";
const EXPECTED_WIDTH = 1540;
const MIN_HEIGHT = 232;

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
  if (!box || box.width !== EXPECTED_WIDTH || box.height < MIN_HEIGHT) {
    throw new Error(`Неверная геометрия отзывов: ${box?.width}×${box?.height}.`);
  }

  const cardStates = await page.locator(".review-card").evaluateAll((cards) => cards.map((card) => {
    const text = card.querySelector(".review-card__text");
    const footer = card.querySelector(".review-card__footer");
    const cardRect = card.getBoundingClientRect();
    const textRect = text.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    return {
      textClipped: text.scrollHeight > text.clientHeight + 2,
      textOverlapsFooter: textRect.bottom > footerRect.top + 2,
      footerEscapesCard: footerRect.bottom > cardRect.bottom + 2,
    };
  }));

  if (cardStates.some((state) => state.textClipped || state.textOverlapsFooter || state.footerEscapesCard)) {
    throw new Error(`Отзывы обрезаются или выходят из карточек: ${JSON.stringify(cardStates)}.`);
  }

  await mkdir("artifacts", { recursive: true });
  const actualPath = "artifacts/reviews-actual.png";
  await reviews.screenshot({ path: actualPath, animations: "disabled" });

  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  console.log(`Reviews elastic cards audit: ${cardStates.length} cards — OK`);
  console.log(`Actual: ${actualPath}`);
} finally {
  await browser?.close();
  server?.kill();
}
