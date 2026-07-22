const getValidationResult = (form) => {
  const consent = form.elements.namedItem("consent");
  const name = form.elements.namedItem("name");
  const phone = form.elements.namedItem("phone");

  if (!name.value.trim() || !phone.value.trim()) {
    return { message: "Заполните имя и телефон.", field: !name.value.trim() ? name : phone };
  }
  if (phone.value.replace(/\D/g, "").length < 10) {
    return { message: "Введите телефон полностью.", field: phone };
  }
  if (!consent.checked) {
    return { message: "Подтвердите согласие на обработку данных.", field: consent };
  }
  return { message: "Форма заполнена. Для отправки заявки позвоните по телефону +7 (495) 125-18-18.", field: null };
};

const setFieldValidity = (form, invalidField) => {
  ["name", "phone", "consent"].forEach((fieldName) => {
    const field = form.elements.namedItem(fieldName);
    field?.setAttribute("aria-invalid", String(field === invalidField));
  });
};

export const initTrialForm = (form) => {
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const status = form.querySelector("[data-form-status], .trial-form__status");
    const result = getValidationResult(form);
    setFieldValidity(form, result.field);
    status.textContent = result.message;
    result.field?.focus();
  });

  form.addEventListener("input", (event) => {
    if (event.target.matches("input, textarea")) event.target.setAttribute("aria-invalid", "false");
  });
};
