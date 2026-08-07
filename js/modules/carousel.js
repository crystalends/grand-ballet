import Swiper from "../../node_modules/swiper/swiper.mjs";
import { A11y, Keyboard, Navigation } from "../../node_modules/swiper/modules/index.mjs";

const getCarouselOptions = (carousel) => {
  const hasVariableMobileHeight = carousel.classList.contains("reviews");

  return {
    modules: [A11y, Keyboard, Navigation],
    slidesPerView: "auto",
    spaceBetween: 20,
    autoHeight: false,
    speed: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 400,
    grabCursor: true,
    watchOverflow: true,
    breakpoints: {
      0: {
        slidesPerView: 1,
        slidesPerGroup: 1,
        spaceBetween: 12,
        roundLengths: true,
        autoHeight: hasVariableMobileHeight,
      },
      481: {
        slidesPerView: "auto",
        spaceBetween: 20,
        roundLengths: false,
        autoHeight: false,
      },
    },
    keyboard: {
      enabled: true,
      onlyInViewport: true,
    },
    navigation: {
      addIcons: false,
      prevEl: carousel.querySelector("[data-carousel-previous]"),
      nextEl: carousel.querySelector("[data-carousel-next]"),
    },
    a11y: {
      containerMessage: carousel.dataset.carouselLabel || "Карусель",
      containerRole: "region",
      containerRoleDescriptionMessage: "карусель",
      itemRoleDescriptionMessage: "слайд",
      slideLabelMessage: "{{index}} из {{slidesLength}}",
      prevSlideMessage: "Предыдущий слайд",
      nextSlideMessage: "Следующий слайд",
      firstSlideMessage: "Это первый слайд",
      lastSlideMessage: "Это последний слайд",
    },
  };
};

const syncTeacherNavigation = (carousel) => {
  const card = carousel.querySelector(".teacher-card");
  if (!card) return;

  const updateNavigationPosition = () => {
    const carouselRect = carousel.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const centerY = cardRect.top - carouselRect.top + cardRect.height / 2;
    carousel.style.setProperty("--teacher-carousel-navigation-y", `${centerY}px`);
  };

  updateNavigationPosition();

  const resizeObserver = new ResizeObserver(updateNavigationPosition);
  resizeObserver.observe(carousel);
  resizeObserver.observe(card);
};

const initCarousel = (carousel) => {
  const viewport = carousel.querySelector("[data-carousel-viewport]");
  if (!viewport) return null;

  viewport.scrollLeft = 0;
  const swiper = new Swiper(viewport, getCarouselOptions(carousel));
  viewport.scrollLeft = 0;
  syncTeacherNavigation(carousel);

  return swiper;
};

export const initCarousels = (carousels) => {
  return Array.from(carousels, initCarousel).filter(Boolean);
};
