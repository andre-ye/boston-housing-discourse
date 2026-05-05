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
- Updated Escape order so after selected-node/card state is cleared, Escape clears search input, suggestions, regex paint, and text spotlight before finally resetting the camera view.
- Made manual search clearing use the same cleanup path, including subreddit filters created from search results.
- Extended search clearing to unwind topic/subtopic/position focus filters as well.
- Plain-text search now treats Enter as "search post bodies for what I typed" — runs a spotlight search instead of auto-jumping to the highest-scored suggestion. Use Arrow keys + Enter to pick a specific suggestion. Shift+Enter still paints regex/multi-kind hits.
- Added a thread-context fisheye to the pinned-point detail card: the pinned post sits at the center of a small radial graph, with up to ten thread siblings arranged around it, color-coded by cluster and connected by edges. A clickable list under the graph mirrors the same satellites; hovering a row highlights its disc and vice versa, and clicking either re-pins the globe to that point so the card refocuses without leaving the panel.
- Added local bookmarks: a star toggle in the top-right of the pinned-point detail card saves the current point (with a snapshot of cluster/subreddit/title/permalink) to localStorage. A floating "★ N saved" chip appears under the Reset-view hint when the list is non-empty and opens a bottom-right Saved-points card listing every bookmark with cluster swatch, kind/subreddit/month, snippet, and saved-at age. Each row click re-pins to that node (refreshing the detail card and fisheye); a per-row × removes one entry and a Clear-all button purges the whole list. Escape closes the bookmarks card right after the detail/interview/position cards in the priority chain, before search clearing.
