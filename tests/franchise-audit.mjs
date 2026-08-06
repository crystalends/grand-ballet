import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const PORT = Number(process.env.FRANCHISE_AUDIT_PORT || 8094);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1920, height: 1080 };
const MIN_EXPECTED_HEIGHT = 8782;
const STABLE_REFERENCE_HEIGHT = 6322;
const MAX_DIFF_RATIO = 0.03;
const expectedSections = [
  [".site-header", 0, 131],
  [".franchise-breadcrumb", 141, 17],
  [".franchise-hero", 198, 325],
  [".franchise-income", 623, 380],
  [".franchise-proof", 1103, 615],
  [".franchise-launch", 1818, 369],
  [".franchise-support", 2287, 534],
  [".franchise-package", 2921, 564],
  [".franchise-finance", 3585, 513],
  [".franchise-manager", 4198, 306],
  [".franchise-plans", 4604, 636],
  [".franchise-director", 5340, 300],
  [".franchise-world", 5740, 482],
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

  await page.goto(`${BASE_URL}/franchise.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  await page.waitForFunction(() => [...document.querySelectorAll("[data-carousel-viewport]")]
    .every((viewport) => viewport.classList.contains("swiper-initialized")));

  const state = await page.evaluate((sections) => {
    const world = document.querySelector(".franchise-world");
    const worldImage = world?.querySelector(".franchise-world__image");
    const worldList = world?.querySelector("ul");
    const worldItem = worldList?.querySelector("li");
    const imageRect = worldImage?.getBoundingClientRect();
    const itemRect = worldItem?.getBoundingClientRect();
    const finance = document.querySelector(".franchise-finance");
    const financeHeading = finance?.querySelector(".franchise-finance__heading");
    const financeCard = finance?.querySelector(".franchise-finance__card");
    const financeDetails = financeCard?.querySelector(".franchise-finance__details");
    const financeRow = financeCard?.querySelector(".franchise-finance__row");
    const financeValues = financeRow?.querySelector("dd");
    const financeValue = financeValues?.querySelector("span");
    const financeCardRect = financeCard?.getBoundingClientRect();

    return {
      dimensions: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      brokenImages: [...document.images]
        .filter((image) => image.naturalWidth === 0)
        .map((image) => image.getAttribute("src")),
      sections: sections.map(([selector]) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? { selector, y: Math.round(rect.y + scrollY), height: Math.round(rect.height) } : { selector };
      }),
      world: {
        background: getComputedStyle(world).backgroundColor,
        image: {
          width: Math.round(imageRect.width),
          height: Math.round(imageRect.height),
          borderRadius: getComputedStyle(worldImage).borderRadius,
        },
        listDisplay: getComputedStyle(worldList).display,
        item: {
          width: Math.round(itemRect.width),
          height: Math.round(itemRect.height),
        },
      },
      finance: {
        headingGap: getComputedStyle(financeHeading).gap,
        card: {
          width: Math.round(financeCardRect.width),
          height: Math.round(financeCardRect.height),
          background: getComputedStyle(financeCard).backgroundColor,
          borderRadius: getComputedStyle(financeCard).borderRadius,
        },
        detailsGap: getComputedStyle(financeDetails).gap,
        rowBorderColor: getComputedStyle(financeRow).borderBottomColor,
        values: {
          display: getComputedStyle(financeValues).display,
          direction: getComputedStyle(financeValues).flexDirection,
          alignItems: getComputedStyle(financeValues).alignItems,
          gap: getComputedStyle(financeValues).gap,
        },
        valueGap: getComputedStyle(financeValue).gap,
      },
    };
  }, expectedSections);

  if (state.dimensions.width !== VIEWPORT.width || state.dimensions.height < MIN_EXPECTED_HEIGHT) {
    throw new Error(`Неверная геометрия страницы: ${state.dimensions.width}×${state.dimensions.height}.`);
  }
  if (state.brokenImages.length) throw new Error(`Не загрузились изображения: ${state.brokenImages.join(", ")}`);

  state.sections.forEach((actual, index) => {
    const [, expectedY, expectedHeight] = expectedSections[index];
    if (actual.y !== expectedY || actual.height !== expectedHeight) {
      throw new Error(`${actual.selector}: получено y=${actual.y}, h=${actual.height}; ожидалось y=${expectedY}, h=${expectedHeight}.`);
    }
  });
  if (state.world.background !== "rgba(219, 176, 125, 0.2)") {
    throw new Error(`Неверный фон секции «Танцуем по всему миру»: ${state.world.background}.`);
  }
  if (state.world.image.width !== 506
    || state.world.image.height !== 402
    || state.world.image.borderRadius !== "40px") {
    throw new Error(`Изображение секции «Танцуем по всему миру» не совпало с Figma: ${JSON.stringify(state.world.image)}.`);
  }
  if (state.world.listDisplay !== "flex"
    || state.world.item.width !== 271
    || state.world.item.height !== 42) {
    throw new Error(`Сетка стран не совпала с Figma: ${JSON.stringify(state.world)}.`);
  }
  if (state.finance.headingGap !== "20px"
    || state.finance.card.width !== 760
    || state.finance.card.height !== 376
    || state.finance.card.background !== "rgb(247, 243, 239)"
    || state.finance.card.borderRadius !== "40px"
    || state.finance.detailsGap !== "10px"
    || state.finance.rowBorderColor !== "rgba(150, 106, 87, 0.2)"
    || state.finance.values.display !== "flex"
    || state.finance.values.direction !== "column"
    || state.finance.values.alignItems !== "flex-end"
    || state.finance.values.gap !== "20px"
    || state.finance.valueGap !== "5px") {
    throw new Error(`Финансовые карточки не совпали с Figma: ${JSON.stringify(state.finance)}.`);
  }

  await page.locator(".franchise-hero [data-application-modal='franchise']").first().click();
  await page.locator(".application-modal[data-variant='franchise']").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");

  await mkdir("artifacts", { recursive: true });
  const actualPath = "artifacts/franchise-actual.png";
  const diffPath = "artifacts/franchise-diff.png";
  await page.screenshot({ path: actualPath, fullPage: true });

  const [referenceBuffer, actualBuffer] = await Promise.all([
    readFile("assets/reference/figma-franchise-1920.png"),
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

  console.log(`Franchise visual diff: ${(diffRatio * 100).toFixed(2)}%`);
  console.log(`Actual: ${actualPath}`);
  console.log(`Diff: ${diffPath}`);

  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  if (diffRatio > MAX_DIFF_RATIO) {
    throw new Error(`Визуальное расхождение ${(diffRatio * 100).toFixed(2)}% превышает лимит ${MAX_DIFF_RATIO * 100}%.`);
  }

  for (const width of [1280, 700, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const responsiveSections = await page.locator(".franchise-world, .franchise-finance").evaluateAll((sections) => (
      sections.map((section) => {
        const sectionRect = section.getBoundingClientRect();
        const overflowingChild = [...section.querySelectorAll("*")].find((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < sectionRect.left - 1 || rect.right > sectionRect.right + 1;
        });
        return {
          selector: section.classList.contains("franchise-world") ? ".franchise-world" : ".franchise-finance",
          sectionWidth: Math.round(sectionRect.width),
          viewportWidth: document.documentElement.clientWidth,
          overflowingChild: overflowingChild?.className || null,
        };
      })
    ));
    responsiveSections.forEach((responsiveSection) => {
      if (responsiveSection.sectionWidth > responsiveSection.viewportWidth
        || responsiveSection.overflowingChild) {
        throw new Error(`${responsiveSection.selector} переполняется на ${width}px: ${JSON.stringify(responsiveSection)}.`);
      }
    });
  }
} finally {
  await browser?.close();
  server?.kill();
}
