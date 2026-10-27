# Recall

A free flashcard app with spaced repetition and blank-page testing. No account, no paywall.

**Open it:** the GitHub Pages link for this repo (Settings → Pages).

## Modes
- **Learn**: spaced repetition. Cards you miss come back in the same session and sooner next time.
- **Cram**: every card, ignoring the schedule. For the last 48 hours before an exam.
- **Blank-page test**: predict your score, answer every card from memory, then see predicted vs. actual.
- **Flip cards**: recognition only. The weakest mode.

## Adding a deck
1. Put a JSON file in `decks/`:
   ```json
   { "title": "ARHI Exam 3", "cards": [ { "front": "...", "back": "...", "image": "https://..." } ] }
   ```
2. Add its filename to `decks/index.json`.

Or ask Claude: "make a Recall deck from chapter 8" and it writes both.

You can also paste a Quizlet export into **Import** on the home screen. That deck lives only in that browser until you copy its file into `decks/`.

## Progress
Saved in your browser. Each device keeps its own. Use **Export progress** to back it up.
