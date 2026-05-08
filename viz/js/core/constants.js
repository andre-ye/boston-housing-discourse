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

// ── Tour spatial picks (radians on the unit sphere) ─────────────────────
export const TOUR_SAME_CLUSTER_MIN_RAD = 0.035;
export const TOUR_SAME_CLUSTER_MAX_RAD = 0.12;
export const TOUR_DIFF_CLUSTER_MIN_RAD = 0.085;
export const TOUR_DIFF_CLUSTER_MAX_RAD = 0.20;
export const TOUR_SEARCH_DENSITY_RAD = 0.18;
