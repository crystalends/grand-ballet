import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";

const BASE_URL = "http://127.0.0.1:8080";
const PAGE_URL = `${BASE_URL}/about.html`;
const VIEWPORT = { width: 1920, height: 1080 };

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
  [".about-hero", 151, 190, 1540],
  [".school-audience", 791, 190, 1540],
  [".about-school", 1271, 190, 1540],
  [".school-director", 1910, 190, 1540],
  [".school-format", 2415, 190, 1540],
  [".school-mission", 2967, 190, 1540],
  [".school-roots", 3496, 190, 1540],
  [".about-team", 4180, 150, 1620],
  [".about-team__inner", 4180, 190, 1540],
  [".school-equipment", 4959, 190, 1540],
  [".school-students", 5353, 190, 1540],
  [".school-leaders", 5720, 190, 1540],
  [".about-seo", 6094, 190, 1540],
  [".trial", 6402, 190, 1540],
  [".site-footer", 6920, 190, 1540],
];

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

  const pageSize = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  if (pageSize.width !== 1920 || pageSize.height !== 7289) throw new Error(`Неверная геометрия страницы: ${pageSize.width}×${pageSize.height}.`);

  for (const [selector, top, left, width] of expectedSections) {
    const box = await page.locator(selector).boundingBox();
    if (!box || Math.abs(box.y - top) > 1 || Math.abs(box.x - left) > 1 || Math.abs(box.width - width) > 1) {
      throw new Error(`${selector}: ожидалось x=${left}, y=${top}, w=${width}; получено ${JSON.stringify(box)}.`);
    }
  }

  const missionLineOffsets = await page.locator(".school-mission .mission-card__line-frame").evaluateAll((frames) => frames.map((frame) => {
    const cardBox = frame.closest(".mission-card").getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    return {
      left: frameBox.left - cardBox.left,
      top: frameBox.top - cardBox.top,
      width: frameBox.width,
      height: frameBox.height,
    };
  }));
  const expectedMissionLines = [
    { left: -65.19, top: -215 },
    { left: -455.19, top: -215 },
    { left: -845.19, top: -124 },
    { left: -1235.19, top: -124 },
  ];
  if (missionLineOffsets.length !== expectedMissionLines.length) throw new Error("В блоке миссии должно быть четыре сегмента общей SVG-линии.");
  missionLineOffsets.forEach((line, index) => {
    const expected = expectedMissionLines[index];
    if (Math.abs(line.left - expected.left) > 0.1 || Math.abs(line.top - expected.top) > 0.1 || Math.abs(line.width - 1695.663) > 0.1 || Math.abs(line.height - 705.026) > 0.1) {
      throw new Error(`Неверная геометрия SVG-линии ${index + 1}: ${JSON.stringify(line)}.`);
    }
  });

  const firstTeacher = await page.locator(".about-team .teacher-card").first().boundingBox();
  if (!firstTeacher || Math.abs(firstTeacher.x - 190) > 1) throw new Error("Карточки педагогов не выровнены по основному контейнеру.");

  await page.locator(".about-team__arrow--next").click();
  await page.waitForTimeout(400);
  if (await page.locator(".about-team__viewport").evaluate((node) => node.swiper?.activeIndex ?? 0) < 1) throw new Error("Карусель педагогов не переключает активный слайд.");
  await page.locator(".trial-form__submit").click();
  if ((await page.locator(".trial-form__status").textContent())?.trim() !== "Заполните имя и телефон.") throw new Error("Не работает валидация формы.");

  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/about-actual.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PAGE_URL, { waitUntil: "networkidle" });
  const mobile = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, broken: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length }));
  if (mobile.scroll > mobile.viewport) throw new Error(`Горизонтальный скролл на мобильном: ${mobile.scroll}px.`);
  if (mobile.broken) throw new Error(`Не загрузились изображения: ${mobile.broken}.`);
  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  console.log("About page geometry, containers, carousel, form and mobile audit: OK");
  console.log("Actual: artifacts/about-actual.png");
} finally {
  await browser?.close();
  server?.kill();
}
