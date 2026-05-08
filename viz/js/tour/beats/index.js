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
import { beat as clickThreeDots }  from './05-click-three-dots.js';
import { beat as clickP2Ferry }    from './06-click-p2-ferry.js';
import { beat as fiveRandom }      from './07-five-random.js';
import { beat as pickTopic }       from './08-pick-topic.js';
import { beat as pickSubtopic }    from './09-pick-subtopic.js';
import { beat as pickStance }      from './10-pick-stance.js';
import { beat as pinAPost }        from './11-pin-a-post.js';
import { beat as connections }     from './12-connections.js';
import { beat as searchCovid }     from './13-search-covid.js';
import { beat as openTimeline }    from './14-open-timeline.js';
import { beat as outro }           from './15-outro.js';

export const BEATS = [
  hero,
  openerData,
  openerSphere,
  openerAlgorithm,
  clickThreeDots,
  clickP2Ferry,
  fiveRandom,
  pickTopic,
  pickSubtopic,
  pickStance,
  pinAPost,
  connections,
  searchCovid,
  openTimeline,
  outro,
];
