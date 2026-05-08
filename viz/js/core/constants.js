// constants — shared magic numbers (geometry, framing, tour spatial picks).

// ── Globe geometry ───────────────────────────────────────────────────────
export const GLOBE_RADIUS = 1.0;
export const POINT_RADIUS = 1.012;     // points sit just above globe surface
export const POINT_SIZE_BASE = 0.024;
export const MIN_ZOOM = 1.18;
export const MAX_ZOOM = 6.0;

// ── Camera framing distances (rotateTo) ──────────────────────────────────
export const DEFAULT_DISTANCE = 3.0;
export const HERO_FRAMING = 3.0;       // tour hero / outro / reset
export const PIN_FRAMING = 2.6;        // interview-pins beat
export const TOPIC_FRAMING = 1.9;      // landing on a single topic
export const SUB_FRAMING = 1.55;       // landing on a subtopic
export const STANCE_FRAMING = 1.5;     // landing on a pin / stance
export const CLOSE_FRAMING = 1.35;     // tight crop on a position / search pocket
export const ZOOM_TO_POINT_FRAMING = 1.8;

// ── Hero idle nudge (px-equivalent per frame) ────────────────────────────
export const HERO_NUDGE_LON = 0.22;
export const HERO_NUDGE_LAT = -0.06;

// ── Opener idle nudge — slightly slower than the hero so the spinning
// globe behind the 3-page reading card doesn't pull the eye off the prose.
export const OPENER_NUDGE_LON = 0.14;
export const OPENER_NUDGE_LAT = -0.04;

// ── Tour spatial picks (radians on the unit sphere) ─────────────────────
export const TOUR_SAME_CLUSTER_MIN_RAD = 0.035;
export const TOUR_SAME_CLUSTER_MAX_RAD = 0.12;
export const TOUR_DIFF_CLUSTER_MIN_RAD = 0.085;
export const TOUR_DIFF_CLUSTER_MAX_RAD = 0.20;
export const TOUR_SEARCH_DENSITY_RAD = 0.18;

// ── Cluster 3 framing (Cycling & Bike Lanes — search + time beats) ───────
// Centroid from tutorial-content.md § Cluster 3 (cl=5, ~13,381 points).
// Framing distance is between TOPIC_FRAMING and HERO_FRAMING — close enough
// that the cluster reads as the subject, wide enough that the search paint
// has room to land.
export const CLUSTER3_CENTROID_LAT = 0.918;
export const CLUSTER3_CENTROID_LON = 0.905;
export const CLUSTER3_FRAMING = 2.1;

// ── Nav bar layout (#31 — text-floor minimum height) ─────────────────────
// Floor height for a stacked bar segment: single label line (11.5px @ 1.22 ≈
// 14px) + minimal vertical padding (top/bottom 3px) = 20px. Below this height
// labels can't render legibly, so every segment is clamped to this minimum
// and the remaining column space is distributed proportionally to each
// segment's pct share. Larger topics still look bigger; tiny ones stay
// readable instead of vanishing as 1-pixel slivers.
export const BAR_SEG_FLOOR_PX = 20;
// Below this rendered span, the segment shows no label (just title attr).
// Set just under the floor so a segment exactly at the floor still labels.
export const BAR_SEG_LABEL_MIN_PX = 14;
// Two-line label kicks in at this height (allows the longer cluster names).
export const BAR_SEG_TWO_LINE_PX = 32;
// Gap between adjacent stacked segments.
export const BAR_SEG_GAP_PX = 1;
// Max bonus added to the floor when distributing leftover column space —
// applies in the overflow path (when even MIN total exceeds container, we
// fall back to a log-scale rank instead of strict proportional).
export const BAR_SEG_PROPORTIONAL_BONUS_PX = 34;

// ── Tour navigation pacing (Phase C1) ────────────────────────────────────
// Promoted "Continue" button fades in this slow when a step task completes
// so the user actually registers the affordance change.
export const TOUR_NEXT_FADE_MS = 500;
// Spotlight dot pulse cycle on beat 5 — slower than the tour-step pulse glow
// so a stationary cluster of three numbered halos doesn't read as nervous
// flicker.
export const TOUR_GLOWING_PULSE_MS = 1400;
// Long-distance camera moves during step beats. The global tour slerp/zoom
// rate is intentionally slow (creates "deliberate camera moves") but for the
// "compare three voices" beat the user reads the rotation as too sluggish —
// snappier short-burst tween wins. Beats opt in by setting beat.cameraSnappy.
export const TOUR_CAMERA_TWEEN_MS = 600;
// Ease rates the globe applies when beat.cameraSnappy is true (per-frame).
// 0.18/0.14 are the non-tour defaults — same feel as normal nav.
export const TOUR_SNAPPY_SLERP_RATE = 0.18;
export const TOUR_SNAPPY_ZOOM_RATE = 0.14;

// ── Subtopic luminance shading (#32 #40) ─────────────────────────────────
// When drilled into a single cluster, sub-points are recolored by sub-id
// to a luminance step within the parent hue. BRIGHT_FACTOR is applied to
// the lowest sub-id; DIM_FACTOR to the highest. Multiplied against the
// linear RGB of the cluster color, then clamped to [0,1].
export const SUB_LUMA_DIM_FACTOR = 0.55;
export const SUB_LUMA_BRIGHT_FACTOR = 1.40;
