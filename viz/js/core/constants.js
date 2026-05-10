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
// Framing for "land on the densest cluster of search hits" — slightly wider
// than ZOOM_TO_POINT_FRAMING so the user sees the whole bright pocket
// rather than zoomed onto its centroid (#49).
export const SEARCH_HITS_FRAMING = 2.0;

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
export const BAR_SEG_PROPORTIONAL_BONUS_PX = 72;

// ── Tour navigation pacing (Phase C1) ────────────────────────────────────
// Promoted "Continue" button fades in this slow when a step task completes
// so the user actually registers the affordance change.
export const TOUR_NEXT_FADE_MS = 500;
// Spotlight dot pulse cycle on beat 5. The global pulse cadence is the slow
// heartbeat in --t-pulse (CSS); this constant is reserved for any JS-driven
// halo timer that wants to match the same beat.
export const TOUR_GLOWING_PULSE_MS = 3500;
// Long-distance camera moves during step beats. The global tour slerp/zoom
// rate is intentionally slow (creates "deliberate camera moves") but for the
// "compare three voices" beat the user reads the rotation as too sluggish —
// snappier short-burst tween wins. Beats opt in by setting beat.cameraSnappy.
export const TOUR_CAMERA_TWEEN_MS = 1500;
// Ease rates the globe applies when beat.cameraSnappy is true (per-frame).
// Slower than the snappy historical defaults — calmer even on opt-in fast
// beats, since the user complained the original snap read as too quick.
export const TOUR_SNAPPY_SLERP_RATE = 0.048;
export const TOUR_SNAPPY_ZOOM_RATE = 0.037;

// ── Globe camera ease rates (per-frame slerp/zoom inside _tick) ──────────
// APP path: click-to-focus, search, nav. TOUR path: tour-cam-snappy class on body (legible motion).
// All rates are 3.75× slower than the historical values so camera moves
// read as deliberate. Per-frame angular velocity is also clamped via
// MAX_ROT_PER_FRAME below so initial swing into a target never reads as a
// snap, only as a steady glide.
export const SLERP_RATE_APP = 0.037;
export const ZOOM_RATE_APP = 0.029;
export const SLERP_RATE_TOUR = 0.024;
export const ZOOM_RATE_TOUR = 0.019;

// ── Camera motion ceilings (applied inside _tick after slerp scaling) ────
// MAX_ROT_PER_FRAME caps angular delta per frame in radians. Long arcs
// glide instead of snap; short corrections still settle quickly because
// the slerp fraction takes over once the residual angle drops below the cap.
export const MAX_ROT_PER_FRAME = 0.023;
// MAX_ZOOM_PER_FRAME caps the absolute |distance| change per frame in scene
// units. Tuned to match the slower rotation feel.
export const MAX_ZOOM_PER_FRAME = 0.024;

// ── Pull-out arc on long camera rotations ────────────────────────────────
// During a rotateTo, the effective distance target is bumped by
// `angleRemaining * ZOOM_LIFT_PER_RAD` so the camera pulls back during
// the swing and zooms back in as it arrives. The lift is also capped so
// the camera never falls outside the user's normal MAX_ZOOM range. Net
// effect: short rotations stay flat (≈0 lift); 90° swing pulls back
// ~0.94 units; 180° swing pulls back ~1.88 units.
export const ZOOM_LIFT_PER_RAD = 0.60;
export const ZOOM_LIFT_MAX = 2.0;

// ── Per-point dim fade (applies when highlight filter changes) ───────────
// Lerp rate per frame for animating point alpha (BRIGHT ↔ DIM ↔ HIDDEN)
// toward its target value. 0.06 ≈ 350ms ease at 60fps — points lose color
// gradually rather than snapping.
export const VIS_FADE_RATE = 0.06;

// ── Scattershot ("R" five-random) layout (#9) ───────────────────────────
// Selection drops the outermost ring of on-screen candidates so sprouts
// don't sit on the cluster edge where they read as "nearly off-screen".
// Pool is sorted by angular distance from the camera focal point; this
// fraction of the farthest candidates is discarded before picking.
export const SPROUT_EDGE_TRIM_FRAC = 0.20;
// Card sizing — keep all five cards visually uniform.
export const SPROUT_MAX_WIDTH_PX = 280;
export const SPROUT_BODY_MAX_CHARS = 160;
// Repulsion layout pass: how many iterations to shove cards apart and
// away from anchor points, and how strong each push is (per-iter px).
export const SPROUT_REPEL_ITERATIONS = 24;
export const SPROUT_REPEL_STEP_PX = 6;
// Anchor avoidance radius — cards repel from any anchor (chosen point's
// projected position) within this many px so cards don't sit on top of
// dense point regions.
export const SPROUT_ANCHOR_AVOID_PX = 36;
// Buffer between cards (px) maintained by the repulsion pass.
export const SPROUT_CARD_GAP_PX = 14;
// Minimum gap from any viewport edge for a card.
export const SPROUT_VIEWPORT_MARGIN_PX = 16;
// Initial radial offset from the anchor when seeding card positions.
export const SPROUT_INITIAL_OFFSET_PX = 84;
// Disc-bounded sampling (#25): the candidate sub-disc is centered on the
// camera focal screen position with diameter = viewport_h * SPROUT_DISC_FRAC,
// i.e. radius = viewport_h * SPROUT_DISC_FRAC / 2. With the default 0.5 the
// diameter equals half the viewport height (radius ≈ viewport_h / 4).
// Cards radiate around a ring at disc_r + SPROUT_DISC_RING_OFFSET_PX so the
// leader lines never cross (#12) — they sit in angular order around the disc,
// always outside the disc boundary.
export const SPROUT_DISC_FRAC = 0.5;
export const SPROUT_DISC_RING_OFFSET_PX = 56;

// ── Three-tier visibility (#5 #34) ───────────────────────────────────────
// Per-point alpha tier values written through setVisibilityTiers().
// BRIGHT = 1.0 matches the existing un-filtered point alpha.
// HIDDEN = 0.12 matches the existing dimmed-out value already used in
// globe.js _recomputeDim (the "filtered out" tier).
// DIM    = 0.38 — new middle tier; sits clearly above the HIDDEN floor so
// parent context (a hovered subtopic's parent topic, etc.) reads as
// "secondary group, still here" rather than blending into background.
export const VIS_TIER = {
  BRIGHT: 1.0,
  DIM: 0.38,
  HIDDEN: 0.12,
};

// ── Subtopic luminance shading (#32 #40) ─────────────────────────────────
// When drilled into a single cluster, sub-points are recolored by sub-id
// to a luminance step within the parent hue. BRIGHT_FACTOR is applied to
// the lowest sub-id; DIM_FACTOR to the highest. Multiplied against the
// linear RGB of the cluster color, then clamped to [0,1].
export const SUB_LUMA_DIM_FACTOR = 0.55;
export const SUB_LUMA_BRIGHT_FACTOR = 1.40;
