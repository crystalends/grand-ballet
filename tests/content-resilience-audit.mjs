import { spawn } from "node:child_process";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";

const PORT = Number(process.env.CONTENT_AUDIT_PORT || 8094);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DEFAULT_PAGES = [
  "index.html",
  "service.html",
  "teachers.html",
  "college-teachers.html",
  "awards.html",
  "license.html",
  "about.html",
  "halls.html",
  "privacy.html",
  "404.html",
  "news.html",
  "news-detail.html",
  "college.html",
  "admissions.html",
  "director.html",
  "preparation.html",
  "directions.html",
  "franchise.html",
  "contacts.html",
];
const DEFAULT_VIEWPORTS = [1600, 1281, 390];
const PAGES = process.env.CONTENT_AUDIT_PAGES
  ? process.env.CONTENT_AUDIT_PAGES.split(",")
  : DEFAULT_PAGES;
const VIEWPORTS = process.env.CONTENT_AUDIT_VIEWPORTS
  ? process.env.CONTENT_AUDIT_VIEWPORTS.split(",").map(Number)
  : DEFAULT_VIEWPORTS;
const FLOW_CASES = {
  "index.html": [
    [".direction-picker", ".direction-picker__title", ".direction-picker__grid"],
  ],
  "service.html": [
    [".lesson-flow", ".lesson-flow__intro p", ".lesson-flow__grid"],
  ],
  "teachers.html": [
    ["main", ".teachers-hero__lead", ".teacher-trust"],
  ],
  "college-teachers.html": [
    ["main", ".teachers-hero__lead", ".teacher-trust"],
  ],
  "license.html": [
    [".documents", ".documents__intro p", ".documents__grid"],
  ],
  "about.html": [
    [".school-format", ".school-format__intro p", ".school-format__grid"],
  ],
  "halls.html": [
    [".hall-gallery", ".hall-gallery__intro p", ".hall-gallery__row"],
  ],
  "college.html": [
    [".college-path", ".college-path__intro p", ".college-path__grid"],
  ],
  "admissions.html": [
    [".college-path--admissions", ".college-path__intro p", ".college-path__grid"],
  ],
  "director.html": [
    [".director-potential", ".director-potential__intro p", ".director-potential__grid"],
  ],
  "preparation.html": [
    [".preparation-audience", ".preparation-audience__intro p", ".preparation-audience__grid"],
  ],
  "directions.html": [
    [".audience-picker", ".audience-picker__heading p", ".audience-picker__grid"],
  ],
  "franchise.html": [
    [".franchise-package__column:nth-child(1)", ".franchise-package__copy p", ".franchise-package__card"],
    [".franchise-package__column:nth-child(3)", ".franchise-package__copy p", ".franchise-package__card"],
  ],
  "contacts.html": [
    [".contacts-locations", ".contacts-locations__title", ".contacts-locations__grid"],
  ],
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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isServerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Локальный сервер не запустился на порту ${PORT}.`);
};

const getExecutablePath = () => process.env.BROWSER_EXECUTABLE_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const verifyFlowDisplacement = (cases) => cases.flatMap(([containerSelector, textSelector, followerSelector]) => {
  const container = document.querySelector(containerSelector);
  const text = container?.querySelector(textSelector);
  const follower = container?.querySelector(followerSelector);
  if (!container || !text || !follower) {
    return [{ containerSelector, error: "Не найден один из элементов flow-проверки." }];
  }

  const originalText = text.textContent;
  const before = {
    textHeight: text.getBoundingClientRect().height,
    followerTop: follower.getBoundingClientRect().top,
    containerHeight: container.getBoundingClientRect().height,
  };
  text.append(document.createTextNode(` ${originalText.trim()}`));
  const after = {
    textHeight: text.getBoundingClientRect().height,
    followerTop: follower.getBoundingClientRect().top,
    containerHeight: container.getBoundingClientRect().height,
  };
  text.textContent = originalText;

  const textGrowth = after.textHeight - before.textHeight;
  const followerShift = after.followerTop - before.followerTop;
  const containerGrowth = after.containerHeight - before.containerHeight;
  if (textGrowth <= 2
    || (followerShift >= textGrowth - 2 && containerGrowth >= textGrowth - 2)) {
    return [];
  }

  return [{
    containerSelector,
    textGrowth: Math.round(textGrowth),
    followerShift: Math.round(followerShift),
    containerGrowth: Math.round(containerGrowth),
  }];
});

const stressContent = () => {
  const primarySelector = [
    "main h1",
    "main h2",
    "main h3",
    "main h4",
    "main p",
    "main li",
    "main dt",
    "main dd",
    "main blockquote",
  ].join(",");
  const secondarySelector = [
    "main a:not(.button)",
    "main span",
    "main strong",
    "main small",
  ].join(",");
  const targets = [
    ...document.querySelectorAll(primarySelector),
    ...[...document.querySelectorAll(secondarySelector)]
      .filter((element) => !element.closest(primarySelector)),
  ]
    .filter((element) => {
      const style = getComputedStyle(element);
      const text = element.textContent.trim();
      return text
        && style.display !== "none"
        && style.visibility !== "hidden"
        && !element.closest("dialog, [role='dialog']");
    });

  for (const element of targets) {
    const text = element.textContent.trim().replace(/\s+/g, " ");
    element.append(document.createTextNode(` ${text} ${text} ${text}`));
  }

  for (const viewport of document.querySelectorAll(".swiper-initialized")) {
    viewport.swiper?.update();
    viewport.swiper?.updateAutoHeight(0);
  }

  const getClassName = (element) => typeof element.className === "string"
    ? element.className.trim()
    : "";
  const escapedText = [];

  for (const target of targets) {
    const targetRect = target.getBoundingClientRect();
    let ancestor = target.parentElement;

    while (ancestor && ancestor !== document.body && ancestor.tagName !== "MAIN") {
      const ancestorRect = ancestor.getBoundingClientRect();
      const style = getComputedStyle(ancestor);
      const className = getClassName(ancestor);
      const isMeasurable = style.display !== "contents"
        && ancestorRect.height > 0
        && className
        && !className.includes("swiper-wrapper");

      if (isMeasurable && targetRect.bottom > ancestorRect.bottom + 2) {
        escapedText.push({
          text: target.textContent.trim().replace(/\s+/g, " ").slice(0, 70),
          target: getClassName(target) || target.tagName.toLowerCase(),
          ancestor: className,
          escapedBy: Math.round(targetRect.bottom - ancestorRect.bottom),
        });
        break;
      }

      ancestor = ancestor.parentElement;
    }
  }

  const clippedContainers = [...document.querySelectorAll("main *")]
    .filter((element) => {
      const style = getComputedStyle(element);
      const overflowY = style.overflowY;
      const containerRect = element.getBoundingClientRect();
      const hasEscapedText = targets
        .some((textElement) => element.contains(textElement)
          && textElement.getBoundingClientRect().bottom > containerRect.bottom + 2);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && (overflowY === "hidden" || overflowY === "clip")
        && element.scrollHeight > element.clientHeight + 2
        && hasEscapedText;
    })
    .map((element) => ({
      element: getClassName(element) || element.tagName.toLowerCase(),
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));

  const root = document.documentElement;
  const horizontalOverflow = root.scrollWidth > root.clientWidth + 2
    ? { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth }
    : null;

  return {
    targetCount: targets.length,
    escapedText: escapedText.slice(0, 20),
    clippedContainers: clippedContainers.slice(0, 20),
    horizontalOverflow,
  };
};

let server;
let browser;

try {
  if (!await isServerReady()) {
    server = spawn("python3", ["-m", "http.server", String(PORT)], { stdio: "ignore" });
    await waitForServer();
  }

  browser = await chromium.launch({ executablePath: getExecutablePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const failures = [];

  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 1000 });

    for (const pageName of PAGES) {
      await page.goto(`${BASE_URL}/${pageName}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const flowFailures = await page.evaluate(verifyFlowDisplacement, FLOW_CASES[pageName] || []);
      const result = await page.evaluate(stressContent);

      if (flowFailures.length
        || result.escapedText.length
        || result.clippedContainers.length
        || result.horizontalOverflow) {
        failures.push({ pageName, width, flowFailures, ...result });
      }
    }
  }

  if (failures.length) {
    throw new Error(`Контент-аудит выявил проблемы:\n${JSON.stringify(failures, null, 2)}`);
  }

  console.log(`Content resilience audit: ${PAGES.length} pages × ${VIEWPORTS.length} viewports — OK`);
} finally {
  await browser?.close();
  server?.kill();
}
