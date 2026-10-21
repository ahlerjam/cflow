# Browser use

A browser is the last rung of the ladder. Use it for JS-rendered content, bot protection, logins and interaction. Static pages go through `WebFetch`.

## Detecting a browser

This plugin depends on the official `playwright` plugin, so a Playwright MCP server (visible window by default) is normally present. Other browser servers, for example a headless one, may exist as well.

Browser tools are usually deferred. Run `ToolSearch` with the query `browser_navigate`. Use the tool names as found and do not assume a prefix.

- Load the tools needed in one `select:` call: navigate, snapshot, click, type, press key, wait for, navigate back, close, or their equivalents.
- If several sets exist, prefer a headless one. Switch to a visible one only for a login or captcha the user must solve.
- Keep to one set per run unless that switch is needed.
- If no browser tool loads (plugin disabled, no Node.js), continue without it and mark affected sources as not readable.

## Reading pages

Read with a snapshot (accessibility tree), not screenshots, unless layout matters. For long pages scroll or open sections. Quote from the snapshot of the exact page cited.

## Dynamic content

Wait for the content instead of re-reading blindly: use the wait tool for a text or element, then snapshot again. If the page loads more on scroll, scroll and snapshot until nothing new appears.

## Consent banners

Reject or close the banner, then snapshot again. Headless sessions are isolated, so the banner reappears on every domain. If it still blocks the content, discard the source with a note.

## Login walls and captchas

- Headless set only: discard the source with a note and continue.
- Visible set: ask the user once (`AskUserQuestion`) to complete the login or captcha in the window, then continue. If the user declines, discard the source.
- Never enter credentials the user did not give for this purpose.

## Search fallback

If `WebSearch` fails or returns nothing, open `https://duckduckgo.com/html/?q=<terms>` in the browser and read the result list from a snapshot. Without a browser, rephrase and retry `WebSearch` once, then record the sub-question as unanswered.

## Closing

Close the browser at the end of the run.
