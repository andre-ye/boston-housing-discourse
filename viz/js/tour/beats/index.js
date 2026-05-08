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
import { beat as connections }     from './12-connections.js';
import { beat as searchCovid }     from './13-search-covid.js';
import { beat as openTimeline }    from './14-open-timeline.js';
import { beat as outro }           from './15-outro.js';

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
  connections,
  searchCovid,
  openTimeline,
  outro,
];
