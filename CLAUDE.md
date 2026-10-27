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
Relay design system: zinc neutrals (#09090B base), one gold (#D4AF37) element per screen, Archivo 800 display, Manrope body, Geist Mono for numbers. Weights 400-600, no all-caps, no gradients or glows, motion under 300ms, no text under 14px.
