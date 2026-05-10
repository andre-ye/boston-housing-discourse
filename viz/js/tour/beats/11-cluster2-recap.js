// Part 2 / Recap — what we learned in the top-down section.

export const beat = {
  id: 'cluster2-recap',
  kind: 'step',
  section: { topic: 'tenant rights & landlords', tool: 'recap', cl: 8 },
  bodyHtml:
    '<p><strong>To recap this section,</strong> you began from ' +
    '<span class="topic-tag" data-cl="8">tenant rights ' +
    'and landlords</span>, a cluster that accounts for about 3% of the ' +
    'corpus. Inside it, you opened the “MA Tenant Rights &amp; Law” ' +
    'subtopic, the largest of five, at 26% of the cluster. The other ' +
    'four subtopics, untouched in this walk, were Repairs &amp; Landlord ' +
    'Issues (22%), Unit Modifications &amp; Appliances (22%), Utilities ' +
    '&amp; Heat Disputes (15%), and Pests &amp; Property Conditions ' +
    '(15%).</p>' +
    '<p>Within “MA Tenant Rights &amp; Law,” the largest of five ' +
    'stances was Lease Terms &amp; Tenant Rights at 42%, covering disputes over ' +
    'lease language, quiet enjoyment, landlord entry, and the small ' +
    'print tenants discover after the fact. The smaller stances around ' +
    'it covered legal representation, evictions, and security deposits. ' +
    'Together they read almost like a legal forum with peer-to-peer ' +
    'triage.</p>' +
    '<p><strong>The takeaway:</strong> top-down tools turn the sphere ' +
    'into a structured map. The names in the left panel and the colours ' +
    'on the globe are the table of contents you browse with.</p>',
  enter() { return () => {}; },
};
