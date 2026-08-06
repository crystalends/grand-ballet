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

  const tabletNewsCarouselSizingIssues = root.clientWidth > 480 && root.clientWidth <= 1280
    ? [...document.querySelectorAll(".home-news .news-card")]
      .map((slide, index) => {
        const viewport = slide.closest(".home-news__viewport");
        const slideRect = slide.getBoundingClientRect();
        const viewportRect = viewport?.getBoundingClientRect();
        return {
          index,
          width: Math.round(slideRect.width),
          height: Math.round(slideRect.height),
          viewportWidth: Math.round(viewportRect?.width || 0),
        };
      })
      .filter((slide) => slide.width > Math.min(620, slide.viewportWidth) + 1
        || slide.height > window.innerHeight + 1)
    : [];

  const tabletTeacherDirectoryIssues = root.clientWidth >= 701 && root.clientWidth <= 1280
    ? [...document.querySelectorAll(".teacher-directory")].flatMap((directory) => {
      const grid = directory.querySelector(".teacher-directory__grid");
      const heading = directory.querySelector(":scope > .section-title");
      const previousSection = directory.previousElementSibling;
      if (!grid || !heading || !previousSection) return [{ error: "incomplete teacher directory" }];

      const gridRect = grid.getBoundingClientRect();
      const headingRect = heading.getBoundingClientRect();
      const directoryRect = directory.getBoundingClientRect();
      const previousRect = previousSection.getBoundingClientRect();
      const cards = [...grid.querySelectorAll(".teacher-card--directory")];
      const mismatchedCards = cards.flatMap((card, index) => {
        const cardRect = card.getBoundingClientRect();
        const imageRect = card.querySelector(".teacher-card__image")?.getBoundingClientRect();
        const copyRect = card.querySelector(".teacher-card__copy")?.getBoundingClientRect();
        if (!imageRect || !copyRect) return [{ index, error: "incomplete teacher card" }];
        const imageRatio = imageRect.width / imageRect.height;
        return Math.abs(cardRect.width - imageRect.width) > 1
          || Math.abs(copyRect.width - imageRect.width) > 1
          || Math.abs(imageRatio - 37 / 40) > .01
          ? [{
            index,
            cardWidth: Math.round(cardRect.width),
            imageWidth: Math.round(imageRect.width),
            copyWidth: Math.round(copyRect.width),
            imageRatio,
          }]
          : [];
      });
      const sectionGap = directoryRect.top - previousRect.bottom;
      const headingGap = gridRect.top - headingRect.bottom;
      return sectionGap > 65 || headingGap > 29 || mismatchedCards.length
        ? [{ sectionGap, headingGap, mismatchedCards }]
        : [];
    })
    : [];

  const adaptiveCollegeFooterBrandIssues = root.clientWidth <= 1280
    ? [...document.querySelectorAll(".college-footer__brand")].flatMap((brand) => {
      const logo = brand.querySelector("img");
      const description = brand.querySelector("p");
      if (!logo || !description) return [{ error: "incomplete college footer brand" }];

      const brandRect = brand.getBoundingClientRect();
      const logoRect = logo.getBoundingClientRect();
      const descriptionRect = description.getBoundingClientRect();
      const contentGap = descriptionRect.top - logoRect.bottom;
      const unusedHeight = brandRect.bottom - descriptionRect.bottom;
      return logoRect.width > 371 || contentGap > 17 || unusedHeight > 1
        ? [{
          brandHeight: Math.round(brandRect.height),
          logoWidth: Math.round(logoRect.width),
          contentGap: Math.round(contentGap),
          unusedHeight: Math.round(unusedHeight),
        }]
        : [];
    })
    : [];

  const mobileHomeAboutButtonIssues = root.clientWidth <= 700
    ? [...document.querySelectorAll(".home-about__button")].flatMap((button) => {
      const panel = button.closest(".home-about__panel");
      if (!panel) return [{ error: "home about button has no panel" }];
      const panelStyle = getComputedStyle(panel);
      const availableWidth = panel.getBoundingClientRect().width
        - parseFloat(panelStyle.paddingLeft)
        - parseFloat(panelStyle.paddingRight);
      const buttonWidth = button.getBoundingClientRect().width;
      return Math.abs(buttonWidth - availableWidth) > 1
        ? [{ buttonWidth: Math.round(buttonWidth), availableWidth: Math.round(availableWidth) }]
        : [];
    })
    : [];

  const franchiseLaunchCardGapIssues = root.clientWidth <= 1280
    ? [...document.querySelectorAll(".franchise-launch__card")]
      .flatMap((card, index) => {
        const icon = card.querySelector(".franchise-launch__card-icon");
        const content = card.querySelector(".franchise-launch__card-content");
        if (!icon || !content) return [{ index, error: "incomplete franchise launch card" }];
        const gap = content.getBoundingClientRect().top - icon.getBoundingClientRect().bottom;
        return Math.abs(gap - 20) > 1 ? [{ index, gap: Math.round(gap) }] : [];
      })
    : [];

  const mobileFranchiseLaunchCardHeightIssues = root.clientWidth <= 700
    ? (() => {
      const cards = [...document.querySelectorAll(".franchise-launch__card")];
      if (!cards.length) return [];
      const sharedMinHeight = parseFloat(getComputedStyle(root).getPropertyValue("--mobile-card-min-feature"));
      const heights = cards.map((card) => card.getBoundingClientRect().height);
      const mismatchedMinHeights = cards
        .map((card, index) => ({ index, minHeight: parseFloat(getComputedStyle(card).minHeight) }))
        .filter(({ minHeight }) => Math.abs(minHeight - sharedMinHeight) > 1);
      const unequalHeights = heights.some((height) => Math.abs(height - heights[0]) > 1);
      return mismatchedMinHeights.length || unequalHeights
        ? [{ sharedMinHeight, heights: heights.map(Math.round), mismatchedMinHeights }]
        : [];
    })()
    : [];

  const newsPageHorizontalOverflowGuardIssue = document.body.classList.contains("news-page")
    && getComputedStyle(document.body).overflowX !== "hidden";

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
    tabletNewsCarouselSizingIssues,
    tabletTeacherDirectoryIssues,
    adaptiveCollegeFooterBrandIssues,
    mobileHomeAboutButtonIssues,
    franchiseLaunchCardGapIssues,
    mobileFranchiseLaunchCardHeightIssues,
    newsPageHorizontalOverflowGuardIssue,
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
      const scrollbarGutterStyle = await page.addStyleTag({ content: "html { scrollbar-gutter: stable; }" });
      const escapedCarouselButtonsWithClassicScrollbar = await page.evaluate(() => {
        const root = document.documentElement;
        return [...document.querySelectorAll(".carousel__button")]
          .filter((button) => {
            const rect = button.getBoundingClientRect();
            const style = getComputedStyle(button);
            return style.display !== "none"
              && style.visibility !== "hidden"
              && rect.width > 0
              && (rect.left < -1 || rect.right > root.clientWidth + 1);
          })
          .map((button) => {
            const rect = button.getBoundingClientRect();
            return {
              className: button.className,
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              clientWidth: root.clientWidth,
            };
          });
      });
      await scrollbarGutterStyle.evaluate((style) => style.remove());
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
      if (escapedCarouselButtonsWithClassicScrollbar.length) {
        failures.push(`${pageName} @ ${width}px: carousel controls outside viewport with classic scrollbar ${JSON.stringify(escapedCarouselButtonsWithClassicScrollbar)}`);
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
      if (state.tabletNewsCarouselSizingIssues.length) {
        failures.push(`${pageName} @ ${width}px: news slides exceed the tablet viewport ${JSON.stringify(state.tabletNewsCarouselSizingIssues)}`);
      }
      if (state.tabletTeacherDirectoryIssues.length) {
        failures.push(`${pageName} @ ${width}px: teacher directory uses mismatched tablet cards or desktop spacing ${JSON.stringify(state.tabletTeacherDirectoryIssues)}`);
      }
      if (state.adaptiveCollegeFooterBrandIssues.length) {
        failures.push(`${pageName} @ ${width}px: college footer brand has an oversized logo or excessive spacing ${JSON.stringify(state.adaptiveCollegeFooterBrandIssues)}`);
      }
      if (state.mobileHomeAboutButtonIssues.length) {
        failures.push(`${pageName} @ ${width}px: home about CTA is not full width ${JSON.stringify(state.mobileHomeAboutButtonIssues)}`);
      }
      if (state.franchiseLaunchCardGapIssues.length) {
        failures.push(`${pageName} @ ${width}px: franchise launch card progress gap is inconsistent ${JSON.stringify(state.franchiseLaunchCardGapIssues)}`);
      }
      if (state.mobileFranchiseLaunchCardHeightIssues.length) {
        failures.push(`${pageName} @ ${width}px: franchise launch cards do not use the shared mobile height ${JSON.stringify(state.mobileFranchiseLaunchCardHeightIssues)}`);
      }
      if (state.newsPageHorizontalOverflowGuardIssue) {
        failures.push(`${pageName} @ ${width}px: news page does not prevent viewport-level horizontal scrolling`);
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
