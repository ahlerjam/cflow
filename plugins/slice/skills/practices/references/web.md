# Cookbook: web UI

## Coverage questions
- Who uses it on which devices and widths? Keyboard-only or screen reader users?
- Every view: what it shows empty, loading, with an error, and with long or many items.
- Forms: validation rules, when errors show, what happens to entered data on error.
- Destructive actions: confirm or undo?
- Login, roles and what each role may see; what a signed-out user sees.
- Language, number and date formats; offline or slow network behaviour.
- Exact wording that matters: button labels, messages, empty states, totals and their number format.
- Keyboard flow: where the focus goes after save, delete, undo and closing a dialog.

## Quality bar
- WCAG 2.2 AA basics: everything works by keyboard with a visible focus, text contrast at least 4.5:1, every field has
  a label, errors are named in text (not only color), click targets at least 24 by 24 px; on touch screens 44 by
  44 px (WCAG 2.5.5).
- After an action that saves a form or removes the focused element, focus moves to a sensible place, never to the
  page body.
- Semantic HTML before ARIA; headings in order; images have alt text.
- System status is visible: each view has its empty, loading and error state.
- Error messages say what happened and what to do, in plain words, without apologizing.
- No horizontal scroll at 360 px; no console errors.
- Looks: follow the `taste` skill.

## E2E approach
Write the steps as Playwright tests in one file against the running app (fill, click, assert visible text and states,
not DOM internals; fail on console errors) and run them in one go; in a sandboxed run session through the Playwright
tools' run-code tool. Look at each screen with the Playwright
browser tools: a screenshot per state and width.

## Sources
- https://www.w3.org/WAI/WCAG22/quickref/
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html
- https://www.nngroup.com/articles/ten-usability-heuristics/
- https://web.dev/learn/accessibility
