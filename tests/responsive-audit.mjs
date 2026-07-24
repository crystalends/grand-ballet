import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { request } from "node:http";
import process from "node:process";
import { chromium } from "playwright-core";

const PORT = Number(process.env.RESPONSIVE_AUDIT_PORT || 8093);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DEFAULT_VIEWPORTS = [1600, 1440, 1280, 1100, 1024, 901, 900, 768, 640, 481, 480, 390, 360, 320];
const DEFAULT_PAGES = [
  "index.html",
  "service.html",
  "teachers.html",
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
];
const VIEWPORTS = process.env.RESPONSIVE_AUDIT_VIEWPORTS
  ? process.env.RESPONSIVE_AUDIT_VIEWPORTS.split(",").map(Number)
  : DEFAULT_VIEWPORTS;
const PAGES = process.env.RESPONSIVE_AUDIT_PAGES
  ? process.env.RESPONSIVE_AUDIT_PAGES.split(",")
  : DEFAULT_PAGES;
const TAKE_SCREENSHOTS = process.env.RESPONSIVE_AUDIT_SCREENSHOTS === "1";

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

const getLayoutState = () => {
  const root = document.documentElement;
  const interactiveSelector = "a[href], button, input, select, textarea";
  const isInsideHorizontalScroller = (element) => {
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== document.body) {
      const overflowX = getComputedStyle(ancestor).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
      ancestor = ancestor.parentElement;
    }
    return false;
  };
  const escapedInteractiveElements = [...document.querySelectorAll(interactiveSelector)]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && rect.width > 0
        && rect.height > 0
        && !element.closest("[data-carousel-viewport]")
        && !isInsideHorizontalScroller(element)
        && (rect.left < -1 || rect.right > root.clientWidth + 1);
    })
    .map((element) => ({
      element: element.tagName.toLowerCase(),
      className: typeof element.className === "string" ? element.className : "",
      text: element.textContent.trim().slice(0, 60),
    }));

  const overflowingElements = [...document.body.querySelectorAll("*")]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && rect.width > 0
        && rect.height > 0
        && !isInsideHorizontalScroller(element)
        && (rect.left < -1 || rect.right > root.clientWidth + 1);
    })
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        element: element.tagName.toLowerCase(),
        className: typeof element.className === "string" ? element.className : "",
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      };
    })
    .sort((a, b) => Math.max(b.right - root.clientWidth, -b.left) - Math.max(a.right - root.clientWidth, -a.left))
    .slice(0, 5);

  const internallyOverflowingElements = [...document.body.querySelectorAll("*")]
    .filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && style.overflowX === "visible"
        && element.scrollWidth > element.clientWidth + 1;
    })
    .map((element) => {
      const style = getComputedStyle(element);
      return {
        element: element.tagName.toLowerCase(),
        className: typeof element.className === "string" ? element.className : "",
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        whiteSpace: style.whiteSpace,
        overflowWrap: style.overflowWrap,
      };
    })
    .sort((a, b) => (b.scrollWidth - b.clientWidth) - (a.scrollWidth - a.clientWidth))
    .slice(0, 5);

  const clippedTextElements = [...document.querySelectorAll("h1, h2, h3, p, a, button, li, dt, dd")]
    .filter((element) => {
      const style = getComputedStyle(element);
      return element.textContent.trim()
        && style.display !== "none"
        && style.visibility !== "hidden"
        && (style.webkitLineClamp === "none" || style.webkitLineClamp === "0")
        && element.clientWidth > 0
        && element.clientHeight > 0
        && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 10);
    })
    .map((element) => ({
      element: element.tagName.toLowerCase(),
      className: typeof element.className === "string" ? element.className : "",
      text: element.textContent.trim().replace(/\s+/g, " ").slice(0, 80),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }))
    .slice(0, 10);

  const nativeScrollingCarousels = [...document.querySelectorAll(".carousel__viewport.swiper-initialized")]
    .filter((viewport) => {
      const { overflowX } = getComputedStyle(viewport);
      return overflowX === "auto" || overflowX === "scroll";
    })
    .map((viewport) => ({
      className: viewport.className,
      overflowX: getComputedStyle(viewport).overflowX,
      clientWidth: viewport.clientWidth,
      scrollWidth: viewport.scrollWidth,
    }));

  const mobileCarouselSizingIssues = root.clientWidth <= 480
    ? [...document.querySelectorAll(".carousel__viewport.swiper-initialized")].flatMap((viewport) => {
      const viewportWidth = viewport.getBoundingClientRect().width;
      const slides = [...viewport.querySelectorAll(".swiper-slide")];
      const incorrectSlides = slides
        .map((slide, index) => ({ index, width: slide.getBoundingClientRect().width }))
        .filter((slide) => Math.abs(slide.width - viewportWidth) > 1);
      const slidesPerView = viewport.swiper?.params.slidesPerView;
      return incorrectSlides.length || slidesPerView !== 1
        ? [{
          className: viewport.className,
          viewportWidth,
          slidesPerView,
          incorrectSlides,
        }]
        : [];
    })
    : [];

  const nonMobileCarouselConfigIssues = root.clientWidth > 480
    ? [...document.querySelectorAll(".carousel__viewport.swiper-initialized")]
      .filter((viewport) => viewport.swiper?.params.slidesPerView !== "auto"
        || viewport.swiper?.params.spaceBetween !== 20
        || viewport.swiper?.params.roundLengths !== false)
      .map((viewport) => ({
        className: viewport.className,
        slidesPerView: viewport.swiper?.params.slidesPerView,
        spaceBetween: viewport.swiper?.params.spaceBetween,
        roundLengths: viewport.swiper?.params.roundLengths,
      }))
    : [];

  return {
    clientWidth: root.clientWidth,
    scrollWidth: root.scrollWidth,
    brokenImages: [...document.images]
      .filter((image) => image.complete && image.naturalWidth === 0)
      .map((image) => image.getAttribute("src")),
    escapedInteractiveElements,
    overflowingElements,
    internallyOverflowingElements,
    clippedTextElements,
    nativeScrollingCarousels,
    mobileCarouselSizingIssues,
    nonMobileCarouselConfigIssues,
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
  if (TAKE_SCREENSHOTS) await mkdir("artifacts/responsive", { recursive: true });

  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 1000 });

    for (const pageName of PAGES) {
      const consoleErrors = [];
      const onConsole = (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      };
      page.on("console", onConsole);
      await page.goto(`${BASE_URL}/${pageName}`, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => [...document.images].every((image) => image.complete));
      if (await page.locator("[data-carousel]").count()) {
        await page.waitForFunction(() => [...document.querySelectorAll("[data-carousel-viewport]")]
          .every((viewport) => viewport.classList.contains("swiper-initialized")));
      }
      const state = await page.evaluate(getLayoutState);
      if (TAKE_SCREENSHOTS) {
        await page.screenshot({
          path: `artifacts/responsive/${pageName.replace(".html", "")}-${width}.png`,
          fullPage: true,
        });
      }
      page.off("console", onConsole);

      if (state.scrollWidth > state.clientWidth) {
        failures.push(`${pageName} @ ${width}px: horizontal overflow ${state.scrollWidth - state.clientWidth}px ${JSON.stringify(state.overflowingElements)} internal=${JSON.stringify(state.internallyOverflowingElements)}`);
      }
      if (state.brokenImages.length) {
        failures.push(`${pageName} @ ${width}px: broken images ${state.brokenImages.join(", ")}`);
      }
      if (state.escapedInteractiveElements.length) {
        failures.push(`${pageName} @ ${width}px: controls outside viewport ${JSON.stringify(state.escapedInteractiveElements)}`);
      }
      if (state.clippedTextElements.length) {
        failures.push(`${pageName} @ ${width}px: clipped text ${JSON.stringify(state.clippedTextElements)}`);
      }
      if (state.nativeScrollingCarousels.length) {
        failures.push(`${pageName} @ ${width}px: Swiper viewport still has native horizontal scrolling ${JSON.stringify(state.nativeScrollingCarousels)}`);
      }
      if (state.mobileCarouselSizingIssues.length) {
        failures.push(`${pageName} @ ${width}px: mobile Swiper must show exactly one full-width slide ${JSON.stringify(state.mobileCarouselSizingIssues)}`);
      }
      if (state.nonMobileCarouselConfigIssues.length) {
        failures.push(`${pageName} @ ${width}px: tablet/desktop Swiper configuration changed ${JSON.stringify(state.nonMobileCarouselConfigIssues)}`);
      }
      if (consoleErrors.length) {
        failures.push(`${pageName} @ ${width}px: console errors ${consoleErrors.join(" | ")}`);
      }
    }
  }

  if (failures.length) {
    throw new Error(`Responsive audit failed:\n${failures.join("\n")}`);
  }

  console.log(`Responsive audit: ${PAGES.length} pages × ${VIEWPORTS.length} viewports — OK`);
} finally {
  await browser?.close();
  server?.kill();
}
