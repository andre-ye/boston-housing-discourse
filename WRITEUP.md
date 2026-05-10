# A Sphere of Boston Housing Conversation — Project Writeup

## 1. Motivation and audience

Boston has been arguing with itself about housing, transit, and what its
streets are for since well before the current mayor's term, and most of
that argument now happens in places a planner or a first-term councillor
cannot easily read in one sitting. The question this project tries to
answer is narrow and practical: if you wanted to understand the *shape*
of that argument — not the headlines, the long tail — where would you
start? The audience is anyone who has to make a decision that touches
Boston housing or transit and wants to feel out the discourse before
committing a position: planners and the MAPC-adjacent research community,
journalists looking for the unbeaten thread under a familiar story,
community groups checking whether the conversation they hear in a meeting
room maps to the one online, and students of the city.

## 2. The data — provenance and limits

Two corpora sit behind the sphere. The first is about 400,000 Reddit
posts and comments from Boston-region subreddits between 2015 and 2025 —
r/boston, r/Massachusetts, r/cambridgema, r/somerville, and the
neighbourhood subs — pulled from the public Academic Torrents dump of
historical Reddit data and filtered to housing, transit, and city-life
content. The second is eighteen in-person interviews conducted on the
street around Boston, surfaced as `P`-pins so that a lived voice can sit
visibly next to the threads it most sounds like. The two together are the
point: Reddit gives breadth and self-selection; the interviews give depth
and a different selection bias. What is missing is not subtle. Boston
Reddit skews white, male, twenty to forty, college-educated, anglophone,
and recently-rented — a demographic profile a domain-expert evaluator
role-playing a MAPC perspective flagged plainly. Eighteen interviews is not a sample, it is a set of voices.
Anyone who is not on Reddit and whom the team did not happen to meet on
the sidewalk is not in this dataset, and the silences in the sphere — no-fault
eviction debates, non-English-speaking renters, the homeowner-stayer
politics of Roxbury, Mattapan, and Hyde Park — are mostly silences in the
source, not in the layout.

## 3. Method

Each post or comment is encoded with BGE-large-en-v1.5, a sentence
embedding model that returns a 1024-dimensional vector whose neighbors
are documents of similar meaning. Those vectors are reduced to 50
dimensions with PCA, a kNN graph is built in the reduced space, and the
graph is then optimized onto the unit sphere with a PyMDE-style
manifold-constrained objective: every gradient step is followed by a
retraction back onto S² so that points are, at all times, true 3D unit
vectors on the surface (`scripts/compute_sphere_pymde.py`). The choice of
a sphere over a flat 2D scatter is deliberate. A 2D layout has corners
and a frame, and the eye reads those as meaningful when they are not; it
also looks like a map and invites the reader to interpret east-west and
up-down as if those directions encoded something. A sphere has no edges
and no privileged direction — to look elsewhere you rotate it, which
makes the arbitrariness of any single view obvious. What this is is a
similarity layout. What it is not is a topic model, a ranking, or an
opinion poll. Nearby points say similar things. The direction between
two clusters carries no meaning.

## 4. Encoding choices

Color encodes topic — the cluster a point belongs to — and position
encodes embedding similarity; nothing else is encoded by either.
Visibility is the third channel and does the heavy narrative work. The
interface uses three opacity tiers — `bright`, `dim`, `hidden` — defined
centrally in `viz/js/core/constants.js` and applied by
`viz/js/features/visibility-tiers.js`, so that hovering a topic, a
subtopic, or a position produces a parent-and-child layering rather than
a hard isolate. The earlier two-tier spotlight (target-bright, everything-else
blacked out) violated the project's own "spotlight, don't isolate" rule
and was replaced. Camera moves are slow on purpose: `SLERP_RATE_TOUR` in
`viz/js/core/constants.js` was tuned up to roughly 2.5× its original
duration after multiple beats in the tour read as snaps rather than
legible motion (`tour-issues.md` items 6, 8, 13). Fast "responsive"
camera transitions were rejected because the tour is teaching the user
that the sphere has parts and you move between them; that lesson requires
the move itself be visible.

## 5. Narrative design rationale

The tour is structured as three case studies in deliberate order, each
teaching a different family of interaction (`tour-proposal.md`,
`tour-plan.md`). Cluster 1, rent control and gentrification, teaches
bottom-up reading: a hover trio for the locality property, a curated
scattershot, and a click-to-pin demo anchored at `commentIdx=342514` in
the r/boston thread *Protest for Rent Control*, one of the densest reply
trees in that corner of the sphere captured in this corpus. Cluster 2, tenant rights and
landlords, teaches top-down navigation through the left rail — topic,
subtopic, position — and lands on `posIdx=3 "Lease Terms & Tenant
Rights"` inside `cl=8 sub=2` (MA Tenant Rights & Law). Cluster 3, bike
lanes, teaches search and time, and uses the cluster-and-query
*intersection* as its central move: when the user types `mass ave` while
inside the cycling cluster, the bright tier shows posts that are both
in the cluster and match the query, while the rest of the corpus matches
sit in the soft tier (`tour-issues.md` #36). Beat copy follows a strict
"do, find" contract — one sentence on what to click, one on what to
notice — and never quotes a comment in the card itself, because the
discovery has to happen in the data, not in the prose. The whole tour
holds to ten beats, roughly two minutes of reading plus interaction time, down
from earlier drafts of fifteen-plus, after the simulated-walkthrough P12
gate flagged that the tour had become longer than the interface beneath
it. Three rounds of copy iteration against that gate cut fabricated-feeling
quotes, lying chips, mechanical beats, and missing payoffs.

## 6. What we learned about Boston discourse

Three findings the visualization actually surfaces, with their caveats.
First, inside `cl=32` (Gentrification & Rent Control) the two largest
subclusters are *supply-side* framings — "build more housing, rent caps
make it worse" — and *displacement* framings; they almost never engage
with each other. On the sphere they sit close because they are about the
same subject, but reading the threads underneath shows the two camps
talking past each other's evidence; the pin-demo
anchor sits in one of the densest reply trees inside the rent-control
cluster captured in this corpus and contains both sides talking past each
other across roughly 275 captured replies. Second,
`cl=8 sub=2` (MA Tenant Rights & Law) is where statute citations live —
eviction retaliation, twenty-four-hour-notice, lead paint — and the
largest position is not about rent at all: 41.6% of points in that
subcluster fall under *Lease Terms & Tenant Rights*, which is lease
language, landlord entry, and security deposits. The abstract argument
of `cl=32` and the concrete help of `cl=8` sit on roughly opposite sides
of the sphere, which is itself a finding. Third, bike-lane discourse
(`cl=5`) grew sharply between 2016 and 2024 — the monthly histogram in
`time_histograms.json` goes from a handful of posts/month in 2016 to
several hundred per month by 2024 — and the content shifts from
logistical (commute notes, Esplanade ice) to political (Mayor Wu,
advocacy-group messaging during the 2024 Council races, lanes blocked by
police cruisers). The honest
caveat the domain-expert evaluator (role-playing a MAPC perspective) flagged
is that Reddit's daily active user base
also grew over that window, so raw counts overstate the rise; the
*change in shape* is the more defensible claim. What the corpus does not
contain is the more interesting list: almost no non-English voice, no
substantial no-fault eviction conversation, very little of the
homeowner-stayer politics of Boston's majority-Black neighborhoods.

## 7. Lessons learned

A tour that is also an exploratory surface is a tension we never fully
resolved. The compromise was to make the tour as small as we could —
ten beats, roughly two minutes of reading plus interaction time — and push depth into the
post-tour interface, but the cost is that the tour lands lighter than we
wanted on the substance of what each cluster is *about*; we still feel
that. The second lesson is methodological: the simulated-user evaluators
(the P12 walkthrough gate and the three-persona evaluator gate documented
across `tour-proposal.md` and `tour-issues.md`) caught real problems
internal review missed — pullquotes that were factually real but wrong to
lift into the card, chip labels that lied about what keys did, mechanical
beats with no payoff, transitions that read as non-sequiturs. Without
that gate we would have shipped a tour that read fluently to its authors
and confusingly to anyone else. The third lesson matters most for re-use:
this dataset is good for hypothesis-generation and bad for citation. The
methods are one click from the opener, behind the *How was this made? →*
link in the About panel, but a careful planner would want the bias
caveats riding visibly on every view, not tucked one click away. If the
project gets a v2, that is the change to make first. Working in iteration
with simulated-user evaluators alongside the team's own playthroughs
proved more rigorous than internal-only review — the gates caught
problems any single set of eyes would have missed.
