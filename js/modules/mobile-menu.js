const MOBILE_BREAKPOINT = "(max-width: 1280px)";

const createMenuToggle = (blockName, nav) => {
  const toggle = document.createElement("button");
  toggle.className = `${blockName}__menu-toggle`;
  toggle.type = "button";
  toggle.setAttribute("aria-controls", nav.id);
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Открыть меню");
  toggle.innerHTML = `<span class="${blockName}__menu-icon" aria-hidden="true"></span>`;
  return toggle;
};

const setMenuState = ({ blockName, mediaQuery, nav, toggle }, requestedState) => {
  const isMobile = mediaQuery.matches;
  const isOpen = isMobile && requestedState;
  nav.classList.toggle(`${blockName}__nav--open`, isOpen);
  nav.inert = isMobile && !isOpen;
  nav.toggleAttribute("aria-hidden", isMobile && !isOpen);
  toggle.setAttribute("aria-expanded", String(isOpen));
  toggle.setAttribute("aria-label", isOpen ? "Закрыть меню" : "Открыть меню");
};

const initMenu = (header, index) => {
  const blockName = header.classList.contains("college-header") ? "college-header" : "site-header";
  const navRow = header.querySelector(`.${blockName}__nav-row`);
  const nav = header.querySelector(`.${blockName}__nav`);
  const actions = header.querySelector(`.${blockName}__actions`);
  if (!navRow || !nav) return null;

  nav.id ||= `${blockName}-navigation-${index + 1}`;
  const toggle = createMenuToggle(blockName, nav);
  const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT);
  const menu = { blockName, mediaQuery, nav, toggle };
  (actions || navRow).append(toggle);
  setMenuState(menu, false);

  toggle.addEventListener("click", () => {
    setMenuState(menu, toggle.getAttribute("aria-expanded") !== "true");
  });

  header.addEventListener("click", (event) => {
    if (event.target.closest(".college-header__dropdown-trigger")) return;
    if (event.target.closest("a, [data-application-modal]")) setMenuState(menu, false);
  });

  header.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || toggle.getAttribute("aria-expanded") !== "true") return;
    setMenuState(menu, false);
    toggle.focus();
  });

  document.addEventListener("pointerdown", (event) => {
    if (toggle.getAttribute("aria-expanded") === "true" && !header.contains(event.target)) {
      setMenuState(menu, false);
    }
  });

  mediaQuery.addEventListener("change", () => setMenuState(menu, false));
  return menu;
};

export const initMobileMenus = (headers) => Array.from(headers || [], initMenu).filter(Boolean);
