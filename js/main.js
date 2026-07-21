import { initFaq } from "./modules/faq.js";
import { initTrialForm } from "./modules/trial-form.js";
import { initDirectionTabs } from "./modules/direction-tabs.js";
import { initTeacherModal } from "./modules/teacher-modal.js";

initFaq(document.querySelector(".faq__list"));
initTrialForm(document.querySelector(".trial-form"));
initDirectionTabs(document.querySelector(".direction-picker__tabs"));
initTeacherModal(document.querySelectorAll(".teacher-card"));

const carousels = document.querySelectorAll("[data-carousel]");

if (carousels.length) {
  import("./modules/carousel.js")
    .then(({ initCarousels }) => initCarousels(carousels))
    .catch((error) => console.error("Не удалось инициализировать карусели.", error));
}
