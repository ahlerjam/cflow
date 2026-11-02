# Cookbook: web UI

## Coverage questions
- Who uses it on which devices and widths? Keyboard-only or screen reader users?
- Every view: what it shows empty, loading, with an error, and with long or many items.
- Forms: validation rules, when errors show, what happens to entered data on error.
- Destructive actions: confirm or undo?
- Login, roles and what each role may see; what a signed-out user sees.
- Language, number and date formats; offline or slow network behaviour.

## Quality bar
- WCAG 2.2 AA basics: everything works by keyboard with a visible focus, text contrast at least 4.5:1, every field has
  a label, errors are named in text (not only color), click targets at least 24 by 24 px.
- Semantic HTML before ARIA; headings in order; images have alt text.
- System status is visible: each view has its empty, loading and error state.
- Error messages say what happened and what to do, in plain words, without apologizing.
- No horizontal scroll at 360 px; no console errors.
- Looks: follow the `taste` skill.

## E2E approach
Drive the running app with the Playwright browser tools: navigate, fill, click, read the text, take a screenshot per
state and width, read the console messages. Assert visible text and states, not DOM internals.

## Sources
- https://www.w3.org/WAI/WCAG22/quickref/
- https://www.nngroup.com/articles/ten-usability-heuristics/
- https://web.dev/learn/accessibility
