// BEATS — ordered tour script.
//
// Each beat module exports a single `beat` object with at minimum:
//   id, kind, enter(ctx) → cleanup
// See ../runner.js for the full contract.
//
// Order matters: the runner walks this array forward (next) and backward
// (prev). Reordering is a content edit, not a code change.

import { beat as hero }            from './01-hero.js';
import { beat as openerData }      from './02-opener-data.js';
import { beat as openerSphere }    from './03-opener-sphere.js';
import { beat as openerAlgorithm } from './04-opener-algorithm.js';
import { beat as cluster1HoverTrio } from './05-cluster1-hover-trio.js';
import { beat as fiveRandom }      from './07-five-random.js';
import { beat as cluster1PinDemo } from './11-cluster1-pin-demo.js';
import { beat as cluster2PickTopic }   from './08-cluster2-pick-topic.js';
import { beat as cluster2Narration }   from './09-cluster2-narration.js';
import { beat as cluster2Stance }      from './10-cluster2-stance.js';
import { beat as cluster3Search }  from './13-cluster3-search.js';
import { beat as cluster3Time }    from './14-cluster3-time.js';
import { beat as outro }           from './15-outro.js';

// Note: a connections beat (12-connections.js) used to live here. The
// connections feature still ships in the UI (toggleable via C key); the
// tour just doesn't narrate it. Per the tutorial-plan the cluster flow is
// cluster1 → cluster2 → cluster3 → outro with no connections beat between.

export const BEATS = [
  hero,
  openerData,
  openerSphere,
  openerAlgorithm,
  cluster1HoverTrio,
  fiveRandom,
  cluster1PinDemo,
  cluster2PickTopic,
  cluster2Narration,
  cluster2Stance,
  cluster3Search,
  cluster3Time,
  outro,
];
