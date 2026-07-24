import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const PORT = Number(process.env.CONTACTS_AUDIT_PORT || 8095);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1920, height: 1080 };
const EXPECTED_HEIGHT = 3593;
const MAX_DIFF_RATIO = 0.02;
const expectedSections = [
  [".site-header", 0, 131],
  [".contacts-breadcrumb", 141, 17],
  [".contacts-hero", 198, 167],
  [".contacts-overview", 465, 450],
  [".contacts-locations", 1015, 519],
  [".contacts-hours", 1634, 330],
  [".faq--contacts", 2064, 542],
  [".trial--contacts", 2706, 478],
  [".site-footer", 3224, 369],
];

const isServerReady = () => new Promise((resolve) => {
  const req = request(BASE_URL, (response) => {
    response.resume();
    resolve(response.statusCode === 200);
  });
  req.on("error", () => resolve(false));
  req.end();
});

const waitForServer = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isServerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Локальный сервер не запустился на порту ${PORT}.`);
};

const getExecutablePath = () => process.env.BROWSER_EXECUTABLE_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const ignoreRegion = (actual, reference, { x, y, width, height }) => {
  for (let row = y; row < y + height; row += 1) {
    const start = (row * actual.width + x) * 4;
    const end = start + width * 4;
    reference.data.copy(actual.data, start, start, end);
  }
};

let server;
let browser;

try {
  if (!await isServerReady()) {
    server = spawn("python3", ["-m", "http.server", String(PORT)], { stdio: "ignore" });
    await waitForServer();
  }

  browser = await chromium.launch({ executablePath: getExecutablePath(), headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(`${BASE_URL}/contacts.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));

  const state = await page.evaluate((sections) => ({
    dimensions: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    },
    brokenImages: [...document.images]
      .filter((image) => image.naturalWidth === 0)
      .map((image) => image.getAttribute("src")),
    sections: sections.map(([selector]) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect
        ? { selector, y: Math.round(rect.y + scrollY), height: Math.round(rect.height) }
        : { selector };
    }),
    contactsHref: document.querySelector('.site-header__nav-link[href="contacts.html"]')?.getAttribute("href"),
    map: (() => {
      const image = document.querySelector(".contacts-overview__map");
      const rect = image?.getBoundingClientRect();
      return {
        element: image?.tagName || null,
        source: image?.getAttribute("src") || null,
        width: Math.round(rect?.width || 0),
        height: Math.round(rect?.height || 0),
        radius: image ? getComputedStyle(image).borderRadius : null,
      };
    })(),
    locationCards: [...document.querySelectorAll(".contact-location")].map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        radius: getComputedStyle(card).borderRadius,
      };
    }),
    cardIcons: [...document.querySelectorAll(".contact-method__icon--phone, .contact-location__icon")].map((icon) => ({
      source: icon.getAttribute("src"),
      width: Math.round(icon.getBoundingClientRect().width),
      height: Math.round(icon.getBoundingClientRect().height),
    })),
  }), expectedSections);

  if (state.dimensions.width !== VIEWPORT.width || state.dimensions.height !== EXPECTED_HEIGHT) {
    throw new Error(`Неверная геометрия страницы: ${state.dimensions.width}×${state.dimensions.height}.`);
  }
  if (state.brokenImages.length) throw new Error(`Не загрузились изображения: ${state.brokenImages.join(", ")}`);
  if (state.contactsHref !== "contacts.html") throw new Error("Пункт «Контакты» не ведёт на contacts.html.");

  state.sections.forEach((actual, index) => {
    const [, expectedY, expectedHeight] = expectedSections[index];
    if (actual.y !== expectedY || actual.height !== expectedHeight) {
      throw new Error(`${actual.selector}: получено y=${actual.y}, h=${actual.height}; ожидалось y=${expectedY}, h=${expectedHeight}.`);
    }
  });
  if (state.map.element !== "IFRAME"
    || !state.map.source.startsWith("https://yandex.ru/map-widget/v1/")
    || state.map.width !== 1150
    || state.map.height !== 450
    || state.map.radius !== "40px") {
    throw new Error(`Карта не совпала с Figma: ${JSON.stringify(state.map)}.`);
  }
  if (state.locationCards.length !== 2
    || state.locationCards.some((card) => card.width !== 760 || card.height !== 421 || card.radius !== "40px")) {
    throw new Error(`Карточки залов не совпали с Figma: ${JSON.stringify(state.locationCards)}.`);
  }
  if (state.cardIcons.length !== 5
    || state.cardIcons.some((icon) => icon.width !== 24
      || icon.height !== 24
      || !icon.source.startsWith("assets/images/contacts/icon-"))) {
    throw new Error(`Иконки карточек не совпали с Figma: ${JSON.stringify(state.cardIcons)}.`);
  }

  const closedFaq = page.locator(".faq-item").nth(1);
  await closedFaq.locator(".faq-item__button").click();
  if (await closedFaq.locator(".faq-item__button").getAttribute("aria-expanded") !== "true") {
    throw new Error("FAQ не раскрывается.");
  }

  await page.locator(".contacts-hours [data-application-modal='trial']").click();
  await page.locator(".application-modal[data-variant='trial']").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));

  await mkdir("artifacts", { recursive: true });
  const actualPath = "artifacts/contacts-actual.png";
  const diffPath = "artifacts/contacts-diff.png";
  await page.screenshot({ path: actualPath, fullPage: true });

  const [referenceBuffer, actualBuffer] = await Promise.all([
    readFile("assets/reference/figma-contacts-1920.png"),
    readFile(actualPath),
  ]);
  const reference = PNG.sync.read(referenceBuffer);
  const actual = PNG.sync.read(actualBuffer);
  ignoreRegion(actual, reference, { x: 580, y: 465, width: 1150, height: 450 });
  const diff = new PNG({ width: reference.width, height: reference.height });
  const differentPixels = pixelmatch(
    reference.data,
    actual.data,
    diff.data,
    reference.width,
    reference.height,
    { threshold: 0.1 },
  );
  await writeFile(diffPath, PNG.sync.write(diff));
  const diffRatio = differentPixels / (reference.width * reference.height);

  console.log(`Contacts visual diff excluding dynamic Yandex map: ${(diffRatio * 100).toFixed(2)}%`);
  console.log(`Actual: ${actualPath}`);
  console.log(`Diff: ${diffPath}`);

  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  if (diffRatio > MAX_DIFF_RATIO) {
    throw new Error(`Визуальное расхождение ${(diffRatio * 100).toFixed(2)}% превышает лимит ${MAX_DIFF_RATIO * 100}%.`);
  }

  for (const width of [1280, 700, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      overflowingSection: [...document.querySelectorAll(
        ".contacts-hero, .contacts-overview, .contacts-locations, .contacts-hours, .faq--contacts, .trial--contacts",
      )].find((section) => {
        const rect = section.getBoundingClientRect();
        return rect.left < -1 || rect.right > document.documentElement.clientWidth + 1;
      })?.className || null,
    }));
    if (overflow.documentWidth > overflow.viewportWidth || overflow.overflowingSection) {
      throw new Error(`Страница переполняется на ${width}px: ${JSON.stringify(overflow)}.`);
    }
  }
} finally {
  await browser?.close();
  server?.kill();
}
