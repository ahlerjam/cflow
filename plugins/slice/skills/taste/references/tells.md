# Tells of machine-made UI

Remove each one you find. Name the replacement, not only the removal.

## Look
- Purple-to-blue or pink-to-orange gradients on hero areas and buttons.
- Every card the same: rounded-xl, soft shadow, 1px gray border, icon in a tinted circle.
- Emoji or stock line icons as the only illustration.
- A centered hero with a headline, a subline and two buttons, followed by three feature cards.
- Glassmorphism, glow, blurred blobs in the background.
- Default Inter or system font at one weight, gray-500 text on white everywhere.
- Equal padding everywhere; no hierarchy through space.

## Default looks
Legitimate when the brief asks for them, generic when nobody chose them:
- Warm cream background with a high-contrast serif and a terracotta or clay accent.
- Near-black background with one acid-green or vermilion accent.
- Broadsheet layout: hairline rules, no radius, dense newspaper columns.
- Template chrome on any subject: an all-caps tracked eyebrow above every heading, meta lines joined with middle
  dots, labels like "WORD — fragment", tinted near-black instead of black, monospace for small labels, an arrow
  appended to every link and button.

## Type and structure
- One accented word in a headline (italic, bold or colored).
- All-caps labels; labels above content that add nothing.
- Numbered markers (01 / 02 / 03) on content that is not a sequence.
- Fade-and-slide-up on every section; hover transitions on every card.

## Content
- "Welcome back, <name>!", "Get started", "Seamless", "Powerful", "Unlock", "Elevate".
- Placeholder data: Lorem ipsum, John Doe, "Item 1", round numbers, all names equally long.
- Three bullet points of equal length, each with a bold lead-in.
- Dashboard tiles with a big number, a small label and a green "+12%" for no reason.
- German text with dashes as punctuation, English button labels in a German UI.
- Vague buttons ("Submit", "OK") instead of the action ("Save changes"); an action renamed along the flow.
- Errors that apologize or stay vague; empty screens without a next action.

## Behavior
- Only the happy state exists: no empty, loading, error or long-data state.
- Spinner for everything; no skeleton shaped like the content.
- Toasts for every action, including ones that need none.
- Hover lift and scale on every element.
- Modals where inline editing would do.

## Code
- Colors, radii and shadows as literals in components instead of tokens.
- Free-form className strings instead of semantic props.
- A wrapper component for a single use.
