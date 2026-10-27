# Recall: instructions for Claude

Recall is Sir's learning headquarters: a static site on GitHub Pages (labelerguy.github.io/Recall). No build step.

## When Sir says "I want to learn X" or "make a Recall deck for Y"
1. Create `decks/<topic>-<deck>.json`:
   ```json
   { "title": "Deck name", "cards": [ { "front": "...", "back": "..." } ] }
   ```
   - Multi-part answers: put one `Label: value` per line in `back` (e.g. `Name: ...`, `Date: ...`). Recall scores each part separately.
   - Picture on the front: add `"wiki": ["Wikipedia_Article_Title"]` (live image) or `"image": "https://..."`, plus `"search": "name"` for the backup search link. Use a front that doesn't give the answer away.
   - Keep each card to one fact or one tightly linked set. Short definitions Sir can memorize, not paragraphs.
2. Add or update the topic in `topics.json`: `id`, `title`, `kind` ("Class" or "Personal"), `exam` (YYYY-MM-DD or null), `decks` (file names).
3. Every fact on a card must be checked. For class material, use Sir's own course material first. Flag anything you couldn't verify instead of guessing.
4. Commit and push to `main`. Pages redeploys in about a minute.

## Rules for changing how Recall teaches
Any new study rule needs a peer-reviewed primary study with a comparison group, read in full text or official abstract. Add it to `RESEARCH.md` with citation, design, result, and verification status before shipping it. No blogs, Wikipedia, or social media as sources.

## Design
Neumorphic (soft UI), per Sir's reference: one light gray surface (#E6E8EC); every element is extruded from it with paired shadows (white top-left, #BEC3CC bottom-right). Raised = cards, rows, buttons. Inset = fields, progress tracks, checked boxes, pressed states. Large radii (20-28px), pill buttons, chevrons on list rows. Monochrome, no accent color; red/green only for Missed/Got it text. Manrope everywhere, Geist Mono for numbers. Wordmark: "RE" outlined + "CALL" solid. Keep text at 14px or larger and contrast at 4.5:1 or better.
