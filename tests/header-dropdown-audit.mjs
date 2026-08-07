import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const BASE_URL = "http://127.0.0.1:8080";
const OFFICIAL_LABELS = [
  "Сведения об образовательной организации",
  "Образование",
  "Документы",
  "Руководство и педагогический состав",
  "Материально-техническое обеспечение",
  "Платные образовательные услуги",
  "Вакантные места",
  "Доступная среда",
];
const APPLICANTS_LABELS = [
  "Поступление",
  "Специальности",
  "Вступительные испытания",
  "Документы для поступления",
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

const differs = (actual, expected) => Object.entries(expected).some(([key, value]) => Math.abs(actual[key] - value) > .1);

const compareScreenshot = async ({ referencePath, actualPath, diffPath, label }) => {
  const [referenceBuffer, actualBuffer] = await Promise.all([readFile(referencePath), readFile(actualPath)]);
  const reference = PNG.sync.read(referenceBuffer);
  const actual = PNG.sync.read(actualBuffer);
  if (reference.width !== actual.width || reference.height !== actual.height) throw new Error(`Размер ${label} ${actual.width}×${actual.height} не совпал с Figma ${reference.width}×${reference.height}.`);
  const diff = new PNG({ width: reference.width, height: reference.height });
  const differentPixels = pixelmatch(reference.data, actual.data, diff.data, reference.width, reference.height, { threshold: .1 });
  await writeFile(diffPath, PNG.sync.write(diff));
  const diffRatio = differentPixels / (reference.width * reference.height);
  console.log(`${label} visual diff: ${(diffRatio * 100).toFixed(2)}%`);
  if (diffRatio > .04) throw new Error(`Визуальное расхождение ${label} ${(diffRatio * 100).toFixed(2)}% превышает 4%.`);
};

const captureMenu = async (menu, path) => {
  await menu.evaluate((element) => {
    element.style.position = "fixed";
    element.style.top = "0";
    element.style.left = "0";
    element.style.transform = "none";
    element.style.boxShadow = "0 0 0 1000px #fcf9f6";
  });
  await menu.screenshot({ path });
  await menu.evaluate((element) => {
    element.style.removeProperty("position");
    element.style.removeProperty("top");
    element.style.removeProperty("left");
    element.style.removeProperty("transform");
    element.style.removeProperty("box-shadow");
  });
};

let server;
let browser;
try {
  if (!await isServerReady()) {
    server = spawn("python3", ["-m", "http.server", "8080"], { stdio: "ignore" });
    await waitForServer();
  }

  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 900 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(`${BASE_URL}/college.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const officialTrigger = page.locator('.college-header__dropdown-trigger[aria-controls^="college-header-dropdown-official-"]');
  const officialMenu = page.locator(".college-header__dropdown-menu--official");
  const applicantsTrigger = page.locator('.college-header__dropdown-trigger[aria-controls^="college-header-dropdown-applicants-"]');
  const applicantsMenu = page.locator(".college-header__dropdown-menu--applicants");
  if (await officialTrigger.count() !== 1 || await officialMenu.count() !== 1 || await applicantsTrigger.count() !== 1 || await applicantsMenu.count() !== 1) throw new Error("В header должны создаваться две выпадашки.");
  if (!await officialMenu.isHidden() || !await applicantsMenu.isHidden()) throw new Error("Выпадашки должны быть закрыты при загрузке.");
  if (await officialTrigger.getAttribute("aria-expanded") !== "false" || await applicantsTrigger.getAttribute("aria-expanded") !== "false") throw new Error("ARIA-состояние закрытых выпадашек некорректно.");

  await officialTrigger.hover();
  if (!await officialMenu.isVisible() || await officialTrigger.getAttribute("aria-expanded") !== "true") throw new Error("Меню сведений не открывается по наведению.");
  const box = await officialMenu.boundingBox();
  if (!box || differs(box, { x: 659, y: 117, width: 461, height: 326 })) throw new Error(`Положение выпадашки не совпало с Figma: ${JSON.stringify(box)}.`);
  const listBox = await officialMenu.locator(".college-header__dropdown-list").boundingBox();
  if (!listBox || differs(listBox, { x: box.x + 40, y: box.y + 40, width: 381, height: 246 })) throw new Error(`Внутренние отступы выпадашки не совпали с Figma: ${JSON.stringify(listBox)}.`);
  const labels = await officialMenu.locator(".college-header__dropdown-link").allTextContents();
  if (JSON.stringify(labels) !== JSON.stringify(OFFICIAL_LABELS)) throw new Error("Состав меню сведений не совпал с Figma.");

  await mkdir("artifacts", { recursive: true });
  const stateActualPath = "artifacts/college-dropdown-open-actual.png";
  const stateDiffPath = "artifacts/college-dropdown-open-diff.png";
  const actualPath = "artifacts/header-dropdown-actual.png";
  const diffPath = "artifacts/header-dropdown-diff.png";
  const applicantsActualPath = "artifacts/applicants-dropdown-actual.png";
  const applicantsDiffPath = "artifacts/applicants-dropdown-diff.png";
  await page.screenshot({ path: stateActualPath, clip: { x: 0, y: 0, width: 1920, height: 544 } });
  await compareScreenshot({ referencePath: "assets/reference/figma-college-dropdown-open.png", actualPath: stateActualPath, diffPath: stateDiffPath, label: "College official dropdown-open state" });
  await captureMenu(officialMenu, actualPath);
  await compareScreenshot({ referencePath: "assets/reference/figma-header-dropdown.png", actualPath, diffPath, label: "Official dropdown" });

  await page.mouse.move(box.x + 40, box.y + 40, { steps: 12 });
  if (!await officialMenu.isVisible()) throw new Error("Меню сведений закрывается при переводе указателя с триггера в выпадашку.");
  await page.mouse.move(10, 500);
  if (!await officialMenu.isHidden()) throw new Error("Меню сведений не закрывается после ухода указателя.");

  await applicantsTrigger.hover();
  if (!await applicantsMenu.isVisible() || await applicantsTrigger.getAttribute("aria-expanded") !== "true") throw new Error("Меню абитуриентов не открывается по наведению.");
  const applicantsBox = await applicantsMenu.boundingBox();
  if (!applicantsBox || differs(applicantsBox, { x: 449, y: 117, width: 327, height: 198 })) throw new Error(`Положение меню абитуриентов не совпало с Figma: ${JSON.stringify(applicantsBox)}.`);
  const applicantsListBox = await applicantsMenu.locator(".college-header__dropdown-list").boundingBox();
  if (!applicantsListBox || differs(applicantsListBox, { x: applicantsBox.x + 40, y: applicantsBox.y + 40, width: 247, height: 118 })) throw new Error(`Внутренние отступы меню абитуриентов не совпали с Figma: ${JSON.stringify(applicantsListBox)}.`);
  const applicantsLabels = await applicantsMenu.locator(".college-header__dropdown-link").allTextContents();
  if (JSON.stringify(applicantsLabels) !== JSON.stringify(APPLICANTS_LABELS)) throw new Error("Состав меню абитуриентов не совпал с Figma.");
  await captureMenu(applicantsMenu, applicantsActualPath);
  await compareScreenshot({ referencePath: "assets/reference/figma-applicants-dropdown.png", actualPath: applicantsActualPath, diffPath: applicantsDiffPath, label: "Applicants dropdown" });

  await page.mouse.move(applicantsBox.x + 40, applicantsBox.y + 40, { steps: 12 });
  if (!await applicantsMenu.isVisible()) throw new Error("Меню абитуриентов закрывается при переводе указателя с триггера в выпадашку.");
  await page.mouse.move(10, 500);
  if (!await applicantsMenu.isHidden()) throw new Error("Меню абитуриентов не закрывается после ухода указателя.");
  await officialTrigger.focus();
  await page.keyboard.press("ArrowDown");
  if (!await officialMenu.isVisible()) throw new Error("Выпадашка не открывается клавишей ArrowDown.");
  if (!await officialMenu.locator(".college-header__dropdown-link").first().evaluate((link) => link === document.activeElement)) throw new Error("Фокус не переходит на первую ссылку.");
  await page.keyboard.press("Escape");
  if (!await officialMenu.isHidden() || !await officialTrigger.evaluate((link) => link === document.activeElement)) throw new Error("Escape не закрывает выпадашку и не возвращает фокус.");
  await officialTrigger.click();
  await page.locator("main").click({ position: { x: 1500, y: 200 } });
  if (!await officialMenu.isHidden()) throw new Error("Клик вне меню не закрывает выпадашку.");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/college.html`, { waitUntil: "networkidle" });
  const menuToggle = page.locator(".college-header__menu-toggle");
  await menuToggle.click();
  const mobileTrigger = page.locator('.college-header__dropdown-trigger[aria-controls^="college-header-dropdown-applicants-"]');
  await mobileTrigger.click();
  await page.waitForTimeout(650);
  if (!await page.locator(".college-header__dropdown-menu--applicants").isVisible() || !await page.locator(".college-header__nav").isVisible()) throw new Error("Мобильная выпадашка закрывает основное меню.");
  const mobileDropdownStyle = await page.locator(".college-header__dropdown-menu--applicants").evaluate((menu) => {
    const menuStyle = getComputedStyle(menu);
    const link = menu.querySelector(".college-header__dropdown-link");
    const linkStyle = getComputedStyle(link);
    return {
      background: menuStyle.backgroundColor,
      radius: menuStyle.borderRadius,
      linkFontSize: linkStyle.fontSize,
      linkHeight: link.getBoundingClientRect().height,
    };
  });
  if (mobileDropdownStyle.background !== "rgba(0, 0, 0, 0)" || mobileDropdownStyle.radius !== "0px") throw new Error("Мобильное подменю должно раскрываться без отдельной карточки.");
  if (mobileDropdownStyle.linkFontSize !== "14px" || mobileDropdownStyle.linkHeight < 40) throw new Error("Размеры ссылок мобильного подменю не совпадают с меню направлений.");
  if (await mobileTrigger.locator("svg, img").count()) throw new Error("У пунктов меню колледжа не должно быть иконок.");
  const mobile = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  if (mobile.scroll > mobile.viewport) throw new Error(`Горизонтальный скролл на мобильном: ${mobile.scroll}px.`);
  await mobileTrigger.click();
  await page.waitForTimeout(650);
  if (await page.locator(".college-header__dropdown-menu--applicants").isVisible() || await mobileTrigger.getAttribute("aria-expanded") !== "false") throw new Error("Повторное нажатие не закрывает мобильное подменю.");
  await mobileTrigger.click();
  await page.waitForTimeout(650);
  if (!await page.locator(".college-header__dropdown-menu--applicants").isVisible() || await mobileTrigger.getAttribute("aria-expanded") !== "true") throw new Error("Мобильное подменю не открывается повторным нажатием.");

  if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(" | ")}`);
  console.log("Header dropdown geometry, visual, pointer, keyboard and mobile audit: OK");
  console.log(`Actual: ${actualPath}`);
  console.log(`Diff: ${diffPath}`);
  console.log(`Full state actual: ${stateActualPath}`);
  console.log(`Full state diff: ${stateDiffPath}`);
  console.log(`Applicants actual: ${applicantsActualPath}`);
  console.log(`Applicants diff: ${applicantsDiffPath}`);
} finally {
  await browser?.close();
  server?.kill();
}
