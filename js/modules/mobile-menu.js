import { createHeaderDirectionsMenu } from "./header-directions-menu.js";

const MOBILE_BREAKPOINT = "(max-width: 1280px)";
const MENU_SHORTCUTS = ["Для детей", "Для взрослых"];

const createMenuShortcuts = () => {
  const list = document.createElement("ul");
  list.className = "site-header__menu-shortcuts";
  list.setAttribute("aria-label", "Направления занятий");

  MENU_SHORTCUTS.forEach((label) => {
    const item = document.createElement("li");
    item.className = "site-header__menu-shortcuts-item";
    const labelElement = document.createElement("span");
    labelElement.className = "site-header__menu-shortcut";
    labelElement.textContent = label;
    item.append(labelElement);
    list.append(item);
  });

  return list;
};

const createMenuContent = (blockName, nav) => {
  if (blockName === "site-header") nav.prepend(createMenuShortcuts());

  const content = document.createElement("div");
  content.className = `${blockName}__menu-content`;
  content.append(...nav.children);
  nav.append(content);
  Array.from(content.children).forEach((item, index) => {
    item.style.setProperty("--menu-item-index", index);
  });
  return content;
};

const createMenuToggle = (blockName, nav) => {
  const toggle = document.createElement("button");
  toggle.className = `${blockName}__menu-toggle`;
  toggle.type = "button";
  toggle.setAttribute("aria-controls", nav.id);
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Открыть меню");
  toggle.innerHTML = `
    <span class="${blockName}__menu-icon" aria-hidden="true">
      <span class="${blockName}__menu-line ${blockName}__menu-line--top"></span>
      <span class="${blockName}__menu-line ${blockName}__menu-line--middle"></span>
      <span class="${blockName}__menu-line ${blockName}__menu-line--bottom"></span>
    </span>
  `;
  return toggle;
};

const setMenuGeometry = ({ nav, navRow }) => {
  const navRowBox = navRow.getBoundingClientRect();
  const bottomGap = Math.min(24, Math.max(16, navRowBox.left));
  nav.style.setProperty("--mobile-menu-top", `${navRowBox.bottom + 10}px`);
  nav.style.setProperty("--mobile-menu-bottom", `${bottomGap}px`);
  nav.style.setProperty("--mobile-menu-left", `${navRowBox.left}px`);
  nav.style.setProperty("--mobile-menu-width", `${navRowBox.width}px`);
};

const setMenuState = ({ blockName, directionsMenu, mediaQuery, nav, navRow, toggle }, requestedState) => {
  const isMobile = mediaQuery.matches;
  const isOpen = isMobile && requestedState;
  if (isOpen) setMenuGeometry({ nav, navRow });
  if (!isOpen) directionsMenu?.close();
  if (!isOpen && blockName === "college-header") {
    nav.dispatchEvent(new CustomEvent("mobile-menu:close-submenus", { bubbles: true }));
  }
  nav.classList.toggle(`${blockName}__nav--open`, isOpen);
  nav.inert = isMobile && !isOpen;
  nav.toggleAttribute("aria-hidden", isMobile && !isOpen);
  toggle.setAttribute("aria-expanded", String(isOpen));
  toggle.setAttribute("aria-label", isOpen ? "Закрыть меню" : "Открыть меню");
  document.body.classList.toggle("mobile-menu-open", isOpen);
};

const initMenu = (header, index) => {
  const blockName = header.classList.contains("college-header") ? "college-header" : "site-header";
  const navRow = header.querySelector(`.${blockName}__nav-row`);
  const nav = header.querySelector(`.${blockName}__nav`);
  const actions = header.querySelector(`.${blockName}__actions`);
  if (!navRow || !nav) return null;

  nav.id ||= `${blockName}-navigation-${index + 1}`;
  const directionsMenu = blockName === "site-header" ? createHeaderDirectionsMenu(nav, index) : null;
  createMenuContent(blockName, nav);
  const toggle = createMenuToggle(blockName, nav);
  const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT);
  const menu = { blockName, directionsMenu, mediaQuery, nav, navRow, toggle };
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
    if (directionsMenu?.isOpen()) {
      directionsMenu.close(true);
      return;
    }
    setMenuState(menu, false);
    toggle.focus();
  });

  document.addEventListener("pointerdown", (event) => {
    if (toggle.getAttribute("aria-expanded") === "true" && !header.contains(event.target)) {
      setMenuState(menu, false);
    }
  });

  const updateOpenMenuGeometry = () => {
    if (toggle.getAttribute("aria-expanded") === "true") setMenuGeometry(menu);
  };
  window.addEventListener("resize", updateOpenMenuGeometry);
  window.visualViewport?.addEventListener("resize", updateOpenMenuGeometry);
  mediaQuery.addEventListener("change", () => setMenuState(menu, false));
  return menu;
};

export const initMobileMenus = (headers) => Array.from(headers || [], initMenu).filter(Boolean);
