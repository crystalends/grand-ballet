import Swiper from "../../node_modules/swiper/swiper.mjs";
import { A11y, Keyboard, Navigation } from "../../node_modules/swiper/modules/index.mjs";

const getCarouselOptions = (carousel) => ({
  modules: [A11y, Keyboard, Navigation],
  slidesPerView: "auto",
  spaceBetween: 20,
  speed: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 400,
  grabCursor: true,
  watchOverflow: true,
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
});

const initCarousel = (carousel) => {
  const viewport = carousel.querySelector("[data-carousel-viewport]");
  if (!viewport) return null;

  return new Swiper(viewport, getCarouselOptions(carousel));
};

export const initCarousels = (carousels) => {
  return Array.from(carousels, initCarousel).filter(Boolean);
};
