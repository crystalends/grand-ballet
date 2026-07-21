---
name: bem-css-methodology
description: Design, review, or refactor CSS class naming with BEM while preserving behavior. Use when Codex works on CSS selectors, HTML class names, component style isolation, block-element-modifier maps, stylesheet naming problems, or a BEM migration.
---

# BEM CSS Methodology

## Goals

- Produce predictable class names that communicate structure and state.
- Keep component styles isolated and reduce selector specificity.
- Preserve existing UI behavior while refactoring naming.
- Make the result easy for a team to extend consistently.

## Core convention

Use these forms:

```text
block
block__element
block--modifier
block__element--modifier
```

- A **block** is an independent UI concept, such as `card` or `navbar`.
- An **element** belongs to a block and has no useful meaning outside it, such as `card__title`.
- A **modifier** represents a variant or state, such as `card--featured` or `card__button--active`.

## Workflow

1. Inspect the relevant markup, styles, component boundaries, and existing naming conventions before editing.
2. Identify independent UI blocks. Prefer domain or component names over location-based names.
3. List each block's elements, variants, and states before proposing class names.
4. Reuse an existing project convention when it is already consistent. Do not introduce BEM into one isolated file if that would make the codebase less coherent.
5. Present a concise naming plan when the refactor affects multiple files or public selectors.
6. Update markup and styles together so no selector is left stale.
7. Search for old selectors after editing and update tests, scripts, or documentation that reference them.
8. Run the project's relevant lint, test, and visual checks when available.

## Naming rules

- Use lowercase kebab-case: `product-card`, not `ProductCard` or `product_card`.
- Keep block names meaningful and independent: prefer `card` over `sidebar-card` when location is not part of the component identity.
- Do not encode the DOM tree in class names. Prefer `card__icon` over `card__header__button__icon`.
- Avoid tag, ID, and deeply nested selectors for component styling.
- Use modifiers for real variants or states, not for arbitrary descendants.
- Keep state naming consistent. If the project already uses `is-active` or ARIA/data attributes for state, integrate with it instead of creating competing conventions.
- Do not use `!important` to compensate for a poor selector structure.

## Example

```html
<article class="card card--featured">
  <h2 class="card__title">Agent skill</h2>
  <p class="card__description">Reusable instructions for an AI agent.</p>
  <button class="card__button card__button--active">Install</button>
</article>
```

```css
.card {
  display: grid;
  gap: 0.75rem;
}

.card--featured {
  border-color: #8b5cf6;
}

.card__title {
  margin: 0;
}

.card__button--active {
  background: #7c3aed;
}
```

## Avoid these patterns

```css
/* Location-dependent and hard to reuse */
.sidebar .card .header h2 {}

/* Element nesting that mirrors the DOM */
.card__header__title {}

/* Modifier without its base class in markup */
.card--featured {}
```

When using a modifier, keep the base class in the markup: `class="card card--featured"`.

## Output expectations

When asked for a review or refactor:

1. Summarize the naming problems that materially affect maintenance.
2. Show the proposed block, element, and modifier map.
3. Make the smallest coherent change that solves the problem.
4. Call out renamed public selectors and possible integration impact.
5. Report validation performed and any checks that could not be run.

## Safety and limits

- Do not change visual behavior unless the user also requests a design change.
- Do not rename selectors generated or required by third-party libraries.
- Treat selectors used by JavaScript, tests, analytics, or external integrations as public contracts and update them carefully.
- Ask for direction before a repo-wide naming migration when the requested scope is ambiguous.
