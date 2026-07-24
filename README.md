# ГРАНДБАЛЕТ — направления

Статическая pixel-perfect реализация Figma-макета на HTML, CSS и модульном JavaScript.

## Запуск

```bash
npm install
npm run serve
```

Откройте:

- `http://127.0.0.1:8080` — главная страница;
- `http://127.0.0.1:8080/service.html` — страница услуги;
- `http://127.0.0.1:8080/license.html` — лицензия и документы.
- `http://127.0.0.1:8080/directions.html` — направления школы.
- `http://127.0.0.1:8080/teachers.html` — педагоги школы.
- `http://127.0.0.1:8080/college-teachers.html` — педагоги колледжа.
- `http://127.0.0.1:8080/about.html` — о школе.
- `http://127.0.0.1:8080/halls.html` — залы школы.
- `http://127.0.0.1:8080/privacy.html` — политика конфиденциальности.
- `http://127.0.0.1:8080/404.html` — страница 404.

Эталонные Figma-экспорты находятся в `assets/reference/`.

## Проверка

```bash
npm run test:quality
npm run test:visual:all
```

`test:quality` запускает BEM-, asset-, link-, responsive- и interaction-аудиты. `test:responsive` проверяет все 19 страниц на 14 ширинах от 320 до 1600 px: горизонтальное переполнение, сломанные изображения, элементы управления за пределами экрана и ошибки консоли. Для точечного прогона можно задать, например:

```bash
RESPONSIVE_AUDIT_VIEWPORTS=390,1024,1440 RESPONSIVE_AUDIT_PAGES=index.html,service.html npm run test:responsive
```

Дополнительно проверьте клавиатурную навигацию по ссылкам, аккордеону FAQ и форме, а также отсутствие ошибок в консоли браузера.
