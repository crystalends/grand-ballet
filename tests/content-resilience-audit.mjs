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
    [".home-about__panel", ".home-about__text p:last-child", ".home-about__mission"],
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
const MATCHED_HEIGHT_CASES = {
  "index.html": [
    [".home-about__panel", ".home-about__image", ".home-about__text p:last-child", 1281],
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
  };
  text.append(document.createTextNode(` ${originalText.trim()}`));
  const textRect = text.getBoundingClientRect();
  const followerRect = follower.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const after = {
    textHeight: textRect.height,
    textBottom: textRect.bottom,
    followerTop: followerRect.top,
    followerBottom: followerRect.bottom,
    containerBottom: containerRect.bottom,
  };
  text.textContent = originalText;

  const textGrowth = after.textHeight - before.textHeight;
  const textOverlap = after.textBottom - after.followerTop;
  const followerEscape = after.followerBottom - after.containerBottom;
  if (textGrowth <= 2 || (textOverlap <= 2 && followerEscape <= 2)) {
    return [];
  }

  return [{
    containerSelector,
    textGrowth: Math.round(textGrowth),
    textOverlap: Math.round(textOverlap),
    followerEscape: Math.round(followerEscape),
  }];
});

const verifyMatchedHeightGrowth = (cases) => cases.flatMap(([contentSelector, mediaSelector, textSelector, minViewportWidth]) => {
  if (window.innerWidth < minViewportWidth) return [];

  const content = document.querySelector(contentSelector);
  const media = document.querySelector(mediaSelector);
  const text = document.querySelector(textSelector);
  if (!content || !media || !text) {
    return [{ contentSelector, mediaSelector, error: "Не найден один из элементов проверки парной высоты." }];
  }

  const originalText = text.textContent;
  text.append(document.createTextNode(` ${originalText.trim()} ${originalText.trim()} ${originalText.trim()}`));
  const contentHeight = content.getBoundingClientRect().height;
  const mediaHeight = media.getBoundingClientRect().height;
  text.textContent = originalText;

  if (Math.abs(contentHeight - mediaHeight) <= 2) return [];
  return [{
    contentSelector,
    mediaSelector,
    contentHeight: Math.round(contentHeight),
    mediaHeight: Math.round(mediaHeight),
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
        && !element.matches(".visually-hidden, .visually-hidden *")
        && style.display !== "none"
        && style.visibility !== "hidden"
        && !element.closest("dialog, [role='dialog']");
    });

  const getClassName = (element) => typeof element.className === "string"
    ? element.className.trim()
    : "";
  const elementIds = new WeakMap();
  let nextElementId = 1;
  const getElementId = (element) => {
    if (!elementIds.has(element)) elementIds.set(element, nextElementId++);
    return elementIds.get(element);
  };
  const collectSiblingOverlaps = () => {
    const overlaps = new Map();
    const containers = [document.querySelector("main"), ...document.querySelectorAll("main *")]
      .filter((container) => container
        && !container.closest("[data-carousel], dialog, [role='dialog']")
        && container.children.length > 1
        && container.children.length <= 30);

    for (const container of containers) {
      const children = [...container.children]
        .filter((child) => {
          const style = getComputedStyle(child);
          const rect = child.getBoundingClientRect();
          return style.display !== "none"
            && style.visibility !== "hidden"
            && style.position !== "absolute"
            && style.position !== "fixed"
            && !style.display.startsWith("inline")
            && rect.width > 2
            && rect.height > 2;
        });

      for (let firstIndex = 0; firstIndex < children.length; firstIndex += 1) {
        const first = children[firstIndex];
        const firstRect = first.getBoundingClientRect();
        for (let secondIndex = firstIndex + 1; secondIndex < children.length; secondIndex += 1) {
          const second = children[secondIndex];
          const secondRect = second.getBoundingClientRect();
          const intersectionWidth = Math.min(firstRect.right, secondRect.right) - Math.max(firstRect.left, secondRect.left);
          const intersectionHeight = Math.min(firstRect.bottom, secondRect.bottom) - Math.max(firstRect.top, secondRect.top);
          if (intersectionWidth <= 2 || intersectionHeight <= 2) continue;

          const key = `${getElementId(container)}:${getElementId(first)}:${getElementId(second)}`;
          overlaps.set(key, {
            container: getClassName(container) || container.tagName.toLowerCase(),
            first: getClassName(first) || first.tagName.toLowerCase(),
            second: getClassName(second) || second.tagName.toLowerCase(),
            intersectionWidth: Math.round(intersectionWidth),
            intersectionHeight: Math.round(intersectionHeight),
          });
        }
      }
    }
    return overlaps;
  };
  const baselineSiblingOverlaps = collectSiblingOverlaps();

  for (const element of targets) {
    const text = element.textContent.trim().replace(/\s+/g, " ");
    element.append(document.createTextNode(` ${text} ${text} ${text}`));
  }

  for (const viewport of document.querySelectorAll(".swiper-initialized")) {
    viewport.swiper?.update();
    viewport.swiper?.updateAutoHeight(0);
  }

  const siblingOverlaps = [...collectSiblingOverlaps()]
    .filter(([key]) => !baselineSiblingOverlaps.has(key))
    .map(([, overlap]) => overlap)
    .slice(0, 20);
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

  const clippedText = targets
    .filter((element) => {
      const style = getComputedStyle(element);
      return element.clientHeight > 0
        && (style.overflowY === "hidden" || style.overflowY === "clip")
        && element.scrollHeight > element.clientHeight + 2;
    })
    .map((element) => ({
      element: getClassName(element) || element.tagName.toLowerCase(),
      text: element.textContent.trim().replace(/\s+/g, " ").slice(0, 70),
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }))
    .slice(0, 20);

  const root = document.documentElement;
  const horizontalOverflow = root.scrollWidth > root.clientWidth + 2
    ? {
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      elements: [...document.querySelectorAll("body *")]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return style.display !== "none"
            && style.visibility !== "hidden"
            && (rect.left < -2 || rect.right > root.clientWidth + 2);
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            element: getClassName(element) || element.tagName.toLowerCase(),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          };
        })
        .slice(0, 20),
      internalElements: [...document.querySelectorAll("body *")]
        .filter((element) => element.scrollWidth > element.clientWidth + 2)
        .map((element) => ({
          element: getClassName(element) || element.tagName.toLowerCase(),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          overflowX: getComputedStyle(element).overflowX,
        }))
        .slice(0, 20),
    }
    : null;

  return {
    targetCount: targets.length,
    escapedText: escapedText.slice(0, 20),
    clippedContainers: clippedContainers.slice(0, 20),
    clippedText,
    siblingOverlaps,
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
      const matchedHeightFailures = await page.evaluate(verifyMatchedHeightGrowth, MATCHED_HEIGHT_CASES[pageName] || []);
      const result = await page.evaluate(stressContent);

      if (flowFailures.length
        || matchedHeightFailures.length
        || result.escapedText.length
        || result.clippedContainers.length
        || result.clippedText.length
        || result.siblingOverlaps.length
        || result.horizontalOverflow) {
        failures.push({ pageName, width, flowFailures, matchedHeightFailures, ...result });
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
