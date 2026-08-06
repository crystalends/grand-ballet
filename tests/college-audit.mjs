import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const PORT = Number(process.env.COLLEGE_AUDIT_PORT || 8098);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1920, height: 1080 };
const EXPECTED_PAGE_HEIGHT = 8400;
const MAX_DIFF_RATIO = 0.04;

const expectedSections = {
  ".college-header": { x: 190, y: 0, width: 1540, height: 126 },
  ".college-hero": { x: 190, y: 146, width: 1540, height: 600 },
  ".college-path": { x: 190, y: 846, width: 1540, height: 566 },
  "#college-audience": { x: 190, y: 1512, width: 1540, height: 424 },
  ".college-programs": { x: 190, y: 2036, width: 1540, height: 348 },
  ".college-admission": { x: 190, y: 2484, width: 1540, height: 782 },
  ".college-preparation": { x: 190, y: 3366, width: 1540, height: 491 },
  ".college-trust": { x: 190, y: 3957, width: 1540, height: 530 },
  ".college-director": { x: 190, y: 4587, width: 1540, height: 511 },
  "#college-teachers": { x: 150, y: 5198, width: 1620, height: 573 },
  ".college-location": { x: 190, y: 5871, width: 1540, height: 548 },
  ".college-official": { x: 190, y: 6519, width: 1540, height: 272 },
  ".college-faq": { x: 190, y: 6891, width: 1540, height: 542 },
  ".trial": { x: 190, y: 7533, width: 1540, height: 478 },
  ".college-footer": { x: 190, y: 8051, width: 1540, height: 349 },
};

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
  throw new Error(`Локальный сервер не запустился на порту ${PORT}.`);
};

const differs = (actual, expected) => Object.entries(expected)
  .some(([key, value]) => Math.abs(actual[key] - value) > .1);

const ignoreRegion = (actual, reference, { x, y, width, height }) => {
  for (let row = y; row < y + height; row += 1) {
    const start = (row * actual.width + x) * 4;
    const end = start + width * 4;
    reference.data.copy(actual.data, start, start, end);
  }
};

const compositeOnBackground = (image, [red, green, blue]) => {
  for (let index = 0; index < image.data.length; index += 4) {
    const alpha = image.data[index + 3] / 255;
    image.data[index] = Math.round(image.data[index] * alpha + red * (1 - alpha));
    image.data[index + 1] = Math.round(image.data[index + 1] * alpha + green * (1 - alpha));
    image.data[index + 2] = Math.round(image.data[index + 2] * alpha + blue * (1 - alpha));
    image.data[index + 3] = 255;
  }
};

let server;
let browser;

try {
  if (!await isServerReady()) {
    server = spawn("python3", ["-m", "http.server", String(PORT)], { stdio: "ignore" });
    await waitForServer();
  }

  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(`${BASE_URL}/college.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  if (dimensions.width !== VIEWPORT.width || dimensions.height !== EXPECTED_PAGE_HEIGHT) {
    throw new Error(`Неверная геометрия страницы: ${dimensions.width}×${dimensions.height}.`);
  }

  for (const [selector, expected] of Object.entries(expectedSections)) {
    const actual = await page.locator(selector).boundingBox();
    if (!actual || differs(actual, expected)) throw new Error(`${selector} расположен не по Figma: ${JSON.stringify(actual)}.`);
  }

  const expectedHeroParts = {
    ".college-hero__main": { x: 190, y: 146, width: 1020, height: 600 },
    ".college-campaign": { x: 1230, y: 146, width: 500, height: 600 },
  };
  for (const [selector, expected] of Object.entries(expectedHeroParts)) {
    const actual = await page.locator(selector).boundingBox();
    if (!actual || differs(actual, expected)) throw new Error(`${selector} расположен не по узлу 175:6129: ${JSON.stringify(actual)}.`);
  }
  const campaignButton = page.locator(".college-campaign__button.button--soft");
  const campaignButtonBox = await campaignButton.boundingBox();
  if (!campaignButtonBox || differs(campaignButtonBox, { x: 1270, y: 658.8125, width: 420, height: 47.1875 })) {
    throw new Error(`Кнопка кампании расположена не по узлу 168:5192: ${JSON.stringify(campaignButtonBox)}.`);
  }

  const collegeAudience = page.locator("#college-audience.school-mission");
  if (await collegeAudience.locator(".mission-card").count() !== 4) throw new Error("Секция аудитории не переиспользует четыре общие mission-card.");
  const missionLines = await collegeAudience.locator(".mission-card__line").evaluateAll((images) => images.map((image) => image.getAttribute("src")));
  if (missionLines.some((source) => source !== "assets/images/about/mission-line.svg")) throw new Error("Секция аудитории не переиспользует общий mission-line.svg.");

  const expectedTeachersParts = {
    "#college-teachers > .slider-shell__inner": { x: 190, y: 5198, width: 1540, height: 573 },
    "#college-teachers > .teachers__arrow--previous": { x: 150, y: 5519, width: 30, height: 30 },
    "#college-teachers > .teachers__arrow--next": { x: 1740, y: 5519, width: 30, height: 30 },
  };
  for (const [selector, expected] of Object.entries(expectedTeachersParts)) {
    const actual = await page.locator(selector).boundingBox();
    if (!actual || differs(actual, expected)) throw new Error(`${selector} не переиспользует стандартную геометрию слайдера: ${JSON.stringify(actual)}.`);
  }

  const collegeMap = page.locator(".location-map--college");
  const collegeMapBox = await collegeMap.boundingBox();
  if (!collegeMapBox || differs(collegeMapBox, { x: 840, y: 5969, width: 890, height: 450 })) throw new Error(`Яндекс Карта расположена не по Figma: ${JSON.stringify(collegeMapBox)}.`);
  const collegeMapSource = await collegeMap.locator(".location-map__frame").getAttribute("src");
  if (!collegeMapSource?.startsWith("https://yandex.ru/map-widget/v1/")) throw new Error("В колледже не переиспользован iframe Яндекс Карт.");
  const locationPanel = page.locator(".college-location__panel");
  if (await locationPanel.locator(".college-location__details > p").count() !== 3) {
    throw new Error("Контактные данные должны быть тремя отдельными строками из узла Figma.");
  }
  if (await page.locator(".college-footer__brand img").getAttribute("src") !== "assets/images/college/logo-footer.png") {
    throw new Error("Footer не использует точный логотип из Figma без контрастного фона.");
  }

  await mkdir("artifacts", { recursive: true });
  const heroActualPath = "artifacts/college-hero-actual.png";
  const heroDiffPath = "artifacts/college-hero-diff.png";
  await page.locator(".college-hero").screenshot({ path: heroActualPath });
  const [heroReferenceBuffer, heroActualBuffer] = await Promise.all([
    readFile("assets/reference/figma-college-hero.png"),
    readFile(heroActualPath),
  ]);
  const heroReference = PNG.sync.read(heroReferenceBuffer);
  const heroActual = PNG.sync.read(heroActualBuffer);
  compositeOnBackground(heroReference, [252, 249, 246]);
  const heroDiff = new PNG({ width: heroReference.width, height: heroReference.height });
  const differentHeroPixels = pixelmatch(
    heroReference.data,
    heroActual.data,
    heroDiff.data,
    heroReference.width,
    heroReference.height,
    { threshold: .1 },
  );
  await writeFile(heroDiffPath, PNG.sync.write(heroDiff));
  const heroDiffRatio = differentHeroPixels / (heroReference.width * heroReference.height);
  console.log(`College hero visual diff: ${(heroDiffRatio * 100).toFixed(2)}%`);
  if (heroDiffRatio > .025) throw new Error(`Hero колледжа отличается от узла Figma на ${(heroDiffRatio * 100).toFixed(2)}%.`);

  const campaignButtonActualPath = "artifacts/college-campaign-button-actual.png";
  const campaignButtonDiffPath = "artifacts/college-campaign-button-diff.png";
  await page.screenshot({
    path: campaignButtonActualPath,
    clip: { x: 1270, y: 659, width: 420, height: 47 },
  });
  const [campaignButtonReferenceBuffer, campaignButtonActualBuffer] = await Promise.all([
    readFile("assets/reference/figma-college-campaign-button.png"),
    readFile(campaignButtonActualPath),
  ]);
  const campaignButtonReference = PNG.sync.read(campaignButtonReferenceBuffer);
  const campaignButtonActual = PNG.sync.read(campaignButtonActualBuffer);
  compositeOnBackground(campaignButtonReference, [244, 210, 171]);
  const campaignButtonDiff = new PNG({ width: campaignButtonReference.width, height: campaignButtonReference.height });
  const differentCampaignButtonPixels = pixelmatch(
    campaignButtonReference.data,
    campaignButtonActual.data,
    campaignButtonDiff.data,
    campaignButtonReference.width,
    campaignButtonReference.height,
    { threshold: .1 },
  );
  await writeFile(campaignButtonDiffPath, PNG.sync.write(campaignButtonDiff));
  const campaignButtonDiffRatio = differentCampaignButtonPixels / (campaignButtonReference.width * campaignButtonReference.height);
  console.log(`College campaign button visual diff: ${(campaignButtonDiffRatio * 100).toFixed(2)}%`);
  if (campaignButtonDiffRatio > .06) throw new Error(`Кнопка кампании отличается от узла Figma на ${(campaignButtonDiffRatio * 100).toFixed(2)}%.`);

  const locationPanelActualPath = "artifacts/college-location-panel-actual.png";
  const locationPanelDiffPath = "artifacts/college-location-panel-diff.png";
  await locationPanel.screenshot({ path: locationPanelActualPath });
  const [locationPanelReferenceBuffer, locationPanelActualBuffer] = await Promise.all([
    readFile("assets/reference/figma-college-location-panel.png"),
    readFile(locationPanelActualPath),
  ]);
  const locationPanelReference = PNG.sync.read(locationPanelReferenceBuffer);
  const locationPanelActual = PNG.sync.read(locationPanelActualBuffer);
  const locationPanelDiff = new PNG({ width: locationPanelReference.width, height: locationPanelReference.height });
  const differentLocationPanelPixels = pixelmatch(
    locationPanelReference.data,
    locationPanelActual.data,
    locationPanelDiff.data,
    locationPanelReference.width,
    locationPanelReference.height,
    { threshold: .1 },
  );
  await writeFile(locationPanelDiffPath, PNG.sync.write(locationPanelDiff));
  const locationPanelDiffRatio = differentLocationPanelPixels / (locationPanelReference.width * locationPanelReference.height);
  console.log(`College location panel visual diff: ${(locationPanelDiffRatio * 100).toFixed(2)}%`);
  if (locationPanelDiffRatio > .045) throw new Error(`Карточка контактов отличается от узла Figma на ${(locationPanelDiffRatio * 100).toFixed(2)}%.`);

  const trustStatement = page.locator(".audience-statement--college");
  if (!await trustStatement.locator(".audience-statement__copy--college").count()) throw new Error("Градиентная карточка не использует блок audience-statement.");
  const trustStatementActualPath = "artifacts/college-trust-statement-actual.png";
  const trustStatementDiffPath = "artifacts/college-trust-statement-diff.png";
  await trustStatement.screenshot({ path: trustStatementActualPath });
  const [trustStatementReferenceBuffer, trustStatementActualBuffer] = await Promise.all([
    readFile("assets/reference/figma-college-trust-statement.png"),
    readFile(trustStatementActualPath),
  ]);
  const trustStatementReference = PNG.sync.read(trustStatementReferenceBuffer);
  const trustStatementActual = PNG.sync.read(trustStatementActualBuffer);
  const trustStatementDiff = new PNG({ width: trustStatementReference.width, height: trustStatementReference.height });
  const differentTrustStatementPixels = pixelmatch(
    trustStatementReference.data,
    trustStatementActual.data,
    trustStatementDiff.data,
    trustStatementReference.width,
    trustStatementReference.height,
    { threshold: .1 },
  );
  await writeFile(trustStatementDiffPath, PNG.sync.write(trustStatementDiff));
  const trustStatementDiffRatio = differentTrustStatementPixels / (trustStatementReference.width * trustStatementReference.height);
  console.log(`College trust statement visual diff: ${(trustStatementDiffRatio * 100).toFixed(2)}%`);
  if (trustStatementDiffRatio > .035) throw new Error(`Градиентная карточка отличается от узла Figma на ${(trustStatementDiffRatio * 100).toFixed(2)}%.`);

  const programs = page.locator(".college-programs");
  if (await programs.locator(".college-program .button--soft").count() !== 2) throw new Error("Карточки программ не переиспользуют общий button--soft.");
  const programsActualPath = "artifacts/college-programs-actual.png";
  const programsDiffPath = "artifacts/college-programs-diff.png";
  await programs.screenshot({ path: programsActualPath });
  const [programsReferenceBuffer, programsActualBuffer] = await Promise.all([
    readFile("assets/reference/figma-college-programs.png"),
    readFile(programsActualPath),
  ]);
  const programsReference = PNG.sync.read(programsReferenceBuffer);
  const programsActual = PNG.sync.read(programsActualBuffer);
  const programsDiff = new PNG({ width: programsReference.width, height: programsReference.height });
  const differentProgramsPixels = pixelmatch(
    programsReference.data,
    programsActual.data,
    programsDiff.data,
    programsReference.width,
    programsReference.height,
    { threshold: .1 },
  );
  await writeFile(programsDiffPath, PNG.sync.write(programsDiff));
  const programsDiffRatio = differentProgramsPixels / (programsReference.width * programsReference.height);
  console.log(`College programs visual diff: ${(programsDiffRatio * 100).toFixed(2)}%`);
  if (programsDiffRatio > .02) throw new Error(`Секция программ отличается от узла Figma на ${(programsDiffRatio * 100).toFixed(2)}%.`);

  const directorActualPath = "artifacts/college-director-actual.png";
  const directorDiffPath = "artifacts/college-director-diff.png";
  await page.locator(".college-director").screenshot({ path: directorActualPath });
  const [directorReferenceBuffer, directorActualBuffer] = await Promise.all([
    readFile("assets/reference/figma-college-director.png"),
    readFile(directorActualPath),
  ]);
  const directorReference = PNG.sync.read(directorReferenceBuffer);
  const directorActual = PNG.sync.read(directorActualBuffer);
  const directorDiff = new PNG({ width: directorReference.width, height: directorReference.height });
  const differentDirectorPixels = pixelmatch(
    directorReference.data,
    directorActual.data,
    directorDiff.data,
    directorReference.width,
    directorReference.height,
    { threshold: .1 },
  );
  await writeFile(directorDiffPath, PNG.sync.write(directorDiff));
  const directorDiffRatio = differentDirectorPixels / (directorReference.width * directorReference.height);
  console.log(`College director visual diff: ${(directorDiffRatio * 100).toFixed(2)}%`);
  if (directorDiffRatio > .025) throw new Error(`Секция директора отличается от узла Figma на ${(directorDiffRatio * 100).toFixed(2)}%.`);

  const actualPath = "artifacts/college-actual.png";
  const diffPath = "artifacts/college-diff.png";
  await page.screenshot({ path: actualPath, fullPage: true });
  const [referenceBuffer, actualBuffer] = await Promise.all([
    readFile("assets/reference/figma-college.png"),
    readFile(actualPath),
  ]);
  const reference = PNG.sync.read(referenceBuffer);
  const actual = PNG.sync.read(actualBuffer);
  ignoreRegion(actual, reference, { x: 840, y: 5969, width: 890, height: 450 });
  const diff = new PNG({ width: reference.width, height: reference.height });
  const differentPixels = pixelmatch(reference.data, actual.data, diff.data, reference.width, reference.height, { threshold: .1 });
  await writeFile(diffPath, PNG.sync.write(diff));
  const diffRatio = differentPixels / (reference.width * reference.height);
  console.log(`College visual diff excluding dynamic Yandex map: ${(diffRatio * 100).toFixed(2)}%`);
  console.log(`Actual: ${actualPath}`);
  console.log(`Diff: ${diffPath}`);
  if (diffRatio > MAX_DIFF_RATIO) throw new Error(`Визуальное расхождение ${(diffRatio * 100).toFixed(2)}% превышает лимит ${MAX_DIFF_RATIO * 100}%.`);

  const teachers = page.locator("#college-teachers");
  const firstTeacherImage = teachers.locator(".teacher-card__image").first();
  if (!await firstTeacherImage.getAttribute("src").then((src) => src?.startsWith("assets/images/service/teacher-"))) {
    throw new Error("Секция колледжа не переиспользует общие изображения педагогов.");
  }
  const teachersTrack = teachers.locator(".teachers__track");
  const initialTransform = await teachersTrack.evaluate((track) => getComputedStyle(track).transform);
  await teachers.locator("[data-carousel-next]").click();
  await page.waitForTimeout(450);
  const movedTransform = await teachersTrack.evaluate((track) => getComputedStyle(track).transform);
  if (movedTransform === initialTransform) throw new Error("Общий слайдер педагогов не перелистывается.");

  const secondQuestion = page.locator(".faq-item").nth(1);
  await secondQuestion.locator(".faq-item__button").click();
  if (await secondQuestion.locator(".faq-item__button").getAttribute("aria-expanded") !== "true") throw new Error("FAQ не раскрывается.");

  const form = page.locator(".trial-form");
  await form.locator('[name="name"]').fill("Тест");
  await form.locator('[name="phone"]').fill("+7 999 000-00-00");
  await form.locator('[name="consent"]').check();
  await form.locator("button").click();
  if (!await form.locator(".trial-form__status").textContent()) throw new Error("Форма не сообщает результат отправки.");

  const campaignGrowth = await page.evaluate(() => {
    const campaign = document.querySelector(".college-campaign");
    const hero = document.querySelector(".college-hero");
    const heroMain = document.querySelector(".college-hero__main");
    const copy = document.querySelector(".college-campaign__copy");
    const button = document.querySelector(".college-campaign__button");
    const nextSection = document.querySelector(".college-path");
    const textNodes = [...copy.querySelectorAll("h2, p")];
    const originalTexts = textNodes.map((node) => node.textContent);
    const getDocumentTop = (element) => element.getBoundingClientRect().top + window.scrollY;
    const before = {
      campaign: campaign.getBoundingClientRect().height,
      hero: hero.getBoundingClientRect().height,
      nextTop: getDocumentTop(nextSection),
    };

    textNodes.forEach((node, index) => {
      node.textContent = Array(3).fill(originalTexts[index]).join(" ");
    });
    const campaignRect = campaign.getBoundingClientRect();
    const copyRect = copy.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const after = {
      campaign: campaignRect.height,
      hero: hero.getBoundingClientRect().height,
      heroMain: heroMain.getBoundingClientRect().height,
      nextTop: getDocumentTop(nextSection),
      copyButtonGap: buttonRect.top - copyRect.bottom,
      buttonBottomInset: campaignRect.bottom - buttonRect.bottom,
      copyClipped: copy.scrollHeight > copy.clientHeight + 1,
    };

    textNodes.forEach((node, index) => { node.textContent = originalTexts[index]; });
    return { before, after };
  });
  const campaignHeightGrowth = campaignGrowth.after.campaign - campaignGrowth.before.campaign;
  if (campaignHeightGrowth <= 2
    || Math.abs(campaignGrowth.after.hero - campaignGrowth.after.campaign) > 1
    || Math.abs(campaignGrowth.after.heroMain - campaignGrowth.after.campaign) > 1
    || campaignGrowth.after.nextTop - campaignGrowth.before.nextTop < campaignHeightGrowth - 1
    || campaignGrowth.after.copyButtonGap < 39
    || campaignGrowth.after.buttonBottomInset < 39
    || campaignGrowth.after.copyClipped) {
    throw new Error(`Карточка приёмной кампании не растёт за текстом: ${JSON.stringify(campaignGrowth)}.`);
  }

  const contentGrowth = await page.evaluate(() => {
    const getHeight = (selector) => document.querySelector(selector).getBoundingClientRect().height;
    const getDocumentTop = (element) => element.getBoundingClientRect().top + window.scrollY;
    const directorText = document.querySelector(".college-director__copy p:last-child");
    const trustText = document.querySelector(".audience-statement__copy--college p:last-child");
    const directorOriginal = directorText.textContent;
    const trustOriginal = trustText.textContent;
    const nextSection = document.querySelector("#college-teachers");
    const before = {
      director: getHeight(".college-director"),
      statement: getHeight(".audience-statement--college"),
      nextTop: getDocumentTop(nextSection),
    };

    directorText.textContent = Array(7).fill(directorOriginal).join(" ");
    trustText.textContent = Array(12).fill(trustOriginal).join(" ");
    const directorPanel = document.querySelector(".college-director__panel");
    const statement = document.querySelector(".audience-statement--college");
    const after = {
      director: getHeight(".college-director"),
      directorMedia: getHeight(".college-director__media"),
      directorPanel: getHeight(".college-director__panel"),
      statement: getHeight(".audience-statement--college"),
      trustBody: getHeight(".college-trust__body"),
      nextTop: getDocumentTop(nextSection),
      directorClipped: directorPanel.scrollHeight > directorPanel.clientHeight + 1,
      statementClipped: statement.scrollHeight > statement.clientHeight + 1,
    };

    directorText.textContent = directorOriginal;
    trustText.textContent = trustOriginal;
    return { before, after };
  });
  const directorGrowth = contentGrowth.after.director - contentGrowth.before.director;
  const statementGrowth = contentGrowth.after.statement - contentGrowth.before.statement;
  const nextSectionShift = contentGrowth.after.nextTop - contentGrowth.before.nextTop;
  if (directorGrowth <= 2
    || statementGrowth <= 2
    || nextSectionShift < directorGrowth + statementGrowth - 2
    || Math.abs(contentGrowth.after.directorMedia - contentGrowth.after.directorPanel) > 1
    || Math.abs(contentGrowth.after.statement - contentGrowth.after.trustBody) > 1
    || contentGrowth.after.directorClipped
    || contentGrowth.after.statementClipped) {
    throw new Error(`Контентные блоки колледжа не растут по тексту: ${JSON.stringify(contentGrowth)}.`);
  }

  for (const width of [1281, 1366, 1440, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    const trustLayout = await page.evaluate(() => {
      const statement = document.querySelector(".audience-statement--college").getBoundingClientRect();
      const grid = document.querySelector(".college-trust__grid").getBoundingClientRect();
      const intersectionWidth = Math.max(0, Math.min(statement.right, grid.right) - Math.max(statement.left, grid.left));
      const intersectionHeight = Math.max(0, Math.min(statement.bottom, grid.bottom) - Math.max(statement.top, grid.top));
      const copy = document.querySelector(".audience-statement__copy--college");
      return {
        intersectionArea: intersectionWidth * intersectionHeight,
        copyClipped: copy.scrollHeight > copy.clientHeight + 1,
      };
    });
    if (trustLayout.intersectionArea > .5 || trustLayout.copyClipped) {
      throw new Error(`Блоки college-trust пересекаются или обрезают текст на ширине ${width}px: ${JSON.stringify(trustLayout)}.`);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileGeometry = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    headerHeroGap: document.querySelector(".college-hero").getBoundingClientRect().top
      - document.querySelector(".college-header").getBoundingClientRect().bottom,
    campaignGap: document.querySelector(".college-campaign__button").getBoundingClientRect().top
      - document.querySelector(".college-campaign__copy").getBoundingClientRect().bottom,
    overflow: Array.from(document.querySelectorAll("body *"))
      .map((element) => ({ selector: element.className || element.tagName, right: element.getBoundingClientRect().right }))
      .filter((item) => item.right > window.innerWidth + .5)
      .slice(0, 8),
  }));
  if (mobileGeometry.width !== mobileGeometry.viewport) throw new Error(`На мобильной ширине появился горизонтальный скролл: ${JSON.stringify(mobileGeometry)}.`);
  if (Math.abs(mobileGeometry.headerHeroGap - 20) > 1) throw new Error(`Неверный отступ между header и hero: ${JSON.stringify(mobileGeometry)}.`);
  if (mobileGeometry.campaignGap < 39) throw new Error(`Текст приёмной кампании налезает на кнопку: ${JSON.stringify(mobileGeometry)}.`);
  if (!await page.locator(".college-hero__image").evaluate((image) => image.complete && image.naturalWidth > 0)) throw new Error("Изображения страницы не загрузились.");
  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
} finally {
  await browser?.close();
  server?.kill();
}
