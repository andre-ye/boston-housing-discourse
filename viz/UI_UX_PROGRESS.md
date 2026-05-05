# UI/UX Progress

## 2026-05-04

- Started UI/UX tweak pass.
- Search now accepts regex terms directly when the query contains regex syntax, e.g. `rent|mortgage`, `\bMBTA\b`, or `sub:afford.*rent`.
- Existing explicit regex forms still work: `/pattern/flags`, `re:pattern`, and field-scoped forms like `text:/(rent|mortgage).*spike/`.
- Invalid regex patterns surface as search errors instead of silently behaving like plain text.
