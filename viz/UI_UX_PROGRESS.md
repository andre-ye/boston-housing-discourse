# UI/UX Progress

## 2026-05-04

- Started UI/UX tweak pass.
- Search now accepts regex terms directly when the query contains regex syntax, e.g. `rent|mortgage`, `\bMBTA\b`, or `sub:afford.*rent`.
- Existing explicit regex forms still work: `/pattern/flags`, `re:pattern`, and field-scoped forms like `text:/(rent|mortgage).*spike/`.
- Invalid regex patterns surface as search errors instead of silently behaving like plain text.

## 2026-05-05

- Scaled globe drag speed by zoom level so close-up panning is substantially slower and more precise.
- Scaled thread/edge tube radius by zoom level so relation lines become thinner near the sphere and no longer dominate close-up views.
- Rebuild edge geometry only when the zoom-derived radius bucket changes, avoiding per-frame geometry churn.
- Follow-up: made the zoom scaling much more aggressive after the first pass looked visually unchanged at common focused zoom levels.
- Changed Shift relations to prefer the selected node: pinned point first, hovered point second, then the old visible-thread overview only when no node is selected.
- Hover/pinned node relations now render all available connections for that thread instead of a capped/random subset.
- Converted Space and Shift from hold interactions into toggled modes; Escape dismisses either mode.
- Centralized selected-node clearing so Escape, reset, voice/interview transitions, and the point detail close button unpin the node and refresh relation mode away from node-only connections.
