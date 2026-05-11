// BEATS — ordered tour script.
//
// Each beat module exports a single `beat` object with at minimum:
//   id, kind, enter(ctx) → cleanup
// See ../runner.js for the full contract.
//
// Order matters: the runner walks this array forward (next) and backward
// (prev). Reordering is a content edit, not a code change.
//
// Tour modules use ?v=… on imports (sync with main.js + tour/index.js +
// index.html main script) so cached ES modules pick up beat copy edits.

import { beat as hero }            from './01-hero.js?v=20260521';
import { beat as openerData }      from './02-opener-data.js?v=20260521';
import { beat as openerSphere }    from './03-opener-sphere.js?v=20260521';
import { beat as openerPreview }   from './04-opener-preview.js?v=20260521';
import { beat as cluster1HoverTrio } from './05-cluster1-hover-trio.js?v=20260521';
import { beat as cluster1ClickPin }  from './06-cluster1-click-pin.js?v=20260521';
import { beat as fiveRandom }      from './07-five-random.js?v=20260521';
import { beat as cluster1Interview } from './07b-cluster1-interview.js?v=20260521';
import { beat as cluster1Recap }    from './07c-cluster1-recap.js?v=20260521';
import { beat as cluster2PickTopic }   from './08-cluster2-pick-topic.js?v=20260521';
import { beat as cluster2Stance }      from './10-cluster2-stance.js?v=20260521';
import { beat as cluster2Recap }       from './11-cluster2-recap.js?v=20260521';
import { beat as cluster3PickCluster } from './12-cluster3-pick-cluster.js?v=20260521';
import { beat as cluster3Search }  from './13-cluster3-search.js?v=20260521';
import { beat as cluster3Time }    from './14-cluster3-time.js?v=20260521';
import { beat as cluster3Recap }   from './14b-cluster3-recap.js?v=20260521';
import { beat as outro }           from './15-outro.js?v=20260521';

// Note: 04-opener-algorithm was removed in v2: the methods folded into
// opener-data's body prose.
//
// Iteration 5 jury cuts:
//   - 01b-contract removed: jury flagged it as filler describing the tour the
//     user already chose. The three-case-study promise folded into 01-hero's
//     lede.
//   - 03-opener-sphere removed: jury flagged "Why a sphere" as a defensive
//     answer to a question the user hasn't asked. The "not a map of Boston"
//     line moved to the About panel.
//   - 09-cluster2-narration merged into 08-cluster2-pick-topic: jury flagged
//     three sequential nav clicks (8 → 9 → 10) as the biggest "I almost left"
//     risk. The merged beat 08 walks the user through both the topic and the
//     subtopic click in one step.

export const BEATS = [
  hero,
  openerData,
  openerSphere,
  openerPreview,
  cluster1HoverTrio,
  cluster1ClickPin,
  fiveRandom,
  cluster1Interview,
  cluster1Recap,
  cluster2PickTopic,
  cluster2Stance,
  cluster2Recap,
  cluster3PickCluster,
  cluster3Search,
  cluster3Time,
  cluster3Recap,
  outro,
];
