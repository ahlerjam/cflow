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

## Content
- "Welcome back, <name>!", "Get started", "Seamless", "Powerful", "Unlock", "Elevate".
- Placeholder data: Lorem ipsum, John Doe, "Item 1", round numbers, all names equally long.
- Three bullet points of equal length, each with a bold lead-in.
- Dashboard tiles with a big number, a small label and a green "+12%" for no reason.
- German text with dashes as punctuation, English button labels in a German UI.

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
