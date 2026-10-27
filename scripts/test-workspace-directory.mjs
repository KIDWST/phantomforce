import assert from 'node:assert/strict';
import { workspaceDirectory, filterWorkspaceDirectory, hasWorkspaceDirectoryAccess } from '../app/js/workspace-directory.js';
import { workspaceChoices, workspaceOptionMarkup } from '../app/js/workspace-access.js';

let checks = 0;
const check = (message, run) => { run(); checks++; };
const owner = { role: 'admin', database: true, canManageAccess: true, isSuperAdmin: true };
const catalog = [
  { tenantId: 'client-chicagoshots', name: 'ChicagoShots', businessId: 'chicagoshots', role: 'owner' },
  { tenantId: 'sports-ops-demo', name: 'Sports Ops Demo', role: 'owner' },
  { tenantId: 'past-due-pilot', name: 'Past Due Pilot', role: 'owner' },
  { tenantId: 'phantomforce-internal', name: 'PhantomForce', businessId: 'phantomforce', role: 'owner' },
  { tenantId: 'customer-one-00000000', name: 'Customer 1 Workspace', role: 'owner' },
  { tenantId: 'recovery-test-workspace', name: 'Recovery Test Workspace', role: 'owner' },
  { tenantId: 'dev-org-phantomforce', name: 'PhantomForce (dev)', role: 'owner' },
  { tenantId: 'dev-org-chicagoshots', name: 'ChicagoShots (dev)', role: 'owner' },
  { tenantId: 'media-lab-qa', name: 'Media Lab QA', role: 'owner' },
  { tenantId: 'media-bridge-qa', name: 'Media Bridge QA', role: 'owner' },
  { tenantId: 'customer-two-00000000', name: 'Customer 1 Workspace', role: 'owner' },
  { tenantId: 'customer-three-00000000', name: 'Customer 1 Workspace', role: 'owner' },
  { tenantId: 'customer-four-00000000', name: 'Customer 1 Workspace', role: 'owner' },
  { tenantId: 'customer-five-00000000', name: 'Customer 1 Workspace', role: 'owner' },
  { tenantId: 'customer-six-00000000', name: 'Customer 1 Workspace', role: 'owner' },
  { tenantId: 'occasionally-odd', name: 'Occasionally Odd', businessId: 'occasionallyodd', role: 'owner' },
];
const choices = workspaceChoices({ account: owner, catalog });
const directory = workspaceDirectory({ account: owner, choices, current: 'occasionally-odd' });
const ids = list => list.map(item => item.id);
const expected = ['phantomforce-internal', 'client-chicagoshots', 'occasionally-odd'];
check('catalog authority is retained', () => assert.equal(choices.length, 16));
check('normal owner picker contains real businesses only', () => assert.deepEqual(ids(directory.primary), expected));
check('all other organizations remain available', () => assert.equal(directory.other.length, 13));
check('no organization disappeared', () => assert.deepEqual([...ids(directory.primary), ...ids(directory.other)].sort(), ids(choices).sort()));
check('input metadata is not mutated', () => assert.equal(choices[0].kind, undefined));
check('server profile metadata survives', () => assert.equal(choices[0].businessId, 'chicagoshots'));
const duplicates = directory.other.filter(item => item.name === 'Customer 1 Workspace');
check('same-named companies are never merged', () => assert.equal(duplicates.length, 6));
check('duplicate labels are unique even with matching suffixes', () => assert.equal(new Set(duplicates.map(item => item.label)).size, 6));
check('duplicate suffix hints are unique', () => assert.equal(new Set(duplicates.map(item => item.idHint)).size, 6));
check('display labels retain original names', () => assert.ok(duplicates.every(item => item.label.startsWith('Customer 1 Workspace · '))));
check('exact organization identity retained', () => assert.ok(duplicates.every(item => choices.some(source => source.id === item.id))));
check('development is labeled honestly', () => assert.equal(directory.other.find(item => item.id === 'dev-org-phantomforce').kind, 'Development'));
check('QA is labeled honestly', () => assert.equal(directory.other.find(item => item.id === 'media-lab-qa').kind, 'Testing'));
check('demo is labeled honestly', () => assert.equal(directory.other.find(item => item.id === 'sports-ops-demo').kind, 'Demo / pilot'));
check('search finds every same-named organization', () => assert.equal(filterWorkspaceDirectory(directory.other, 'Customer 1').length, 6));
check('search supports exact IDs', () => assert.deepEqual(ids(filterWorkspaceDirectory(directory.other, 'customer-two-00000000')), ['customer-two-00000000']));
check('search supports category', () => assert.equal(filterWorkspaceDirectory(directory.other, 'development').length, 2));
check('search combines terms', () => assert.deepEqual(ids(filterWorkspaceDirectory(directory.other, 'media bridge')), ['media-bridge-qa']));
check('empty search returns all preserved choices', () => assert.equal(filterWorkspaceDirectory(directory.other, '').length, 13));
check('no invented match', () => assert.equal(filterWorkspaceDirectory(directory.other, 'not-a-workspace').length, 0));

const activeOther = workspaceDirectory({ account: owner, choices, current: 'customer-two-00000000' });
check('active nonbusiness remains visible', () => assert.deepEqual(ids(activeOther.primary), [...expected, 'customer-two-00000000']));
check('active workspace is not repeated in management', () => assert.ok(!ids(activeOther.other).includes('customer-two-00000000')));
check('active other is identified explicitly', () => assert.equal(activeOther.activeOther.id, 'customer-two-00000000'));
check('opening the directory does not change the active ID', () => assert.equal(activeOther.primary.at(-1).id, 'customer-two-00000000'));
const html = workspaceOptionMarkup(choices, 'occasionally-odd', owner);
check('top native select has three business values and account options', () => assert.equal((html.match(/<option /g) || []).length, 4));
check('test namespace is absent from normal picker', () => assert.ok(!html.includes('media-lab-qa')));
check('current ID is selected exactly', () => assert.match(html, /value="occasionally-odd" selected/));
check('active other value stays selectable', () => assert.match(workspaceOptionMarkup(choices, 'customer-two-00000000', owner), /value="customer-two-00000000" selected/));
check('unselected owner receives a disabled placeholder', () => assert.match(workspaceOptionMarkup(choices, '__unselected__', owner), /value="__unselected__" disabled selected>Choose a business/));
check('missing current ID does not invent a switchable organization', () => assert.match(workspaceOptionMarkup(choices, 'missing-org', owner), /value="missing-org" disabled selected>Current workspace/));

for (const account of [
  { role: 'admin', database: true, orgRole: 'owner', canManageAccess: false, isSuperAdmin: false },
  { role: 'employee', database: true, isSuperAdmin: false },
  { role: 'admin', localCustomer: true, orgId: 'customer-one-00000000' },
  { role: 'employee', name: 'PhantomForce Owner', canManageAccess: true },
]) {
  check('ordinary account is not a platform directory owner', () => assert.equal(hasWorkspaceDirectoryAccess(account), false));
  check('ordinary account retains every authorized membership', () => assert.deepEqual(ids(workspaceDirectory({ account, choices }).primary), ids(choices)));
}
check('customer scope remains pinned', () => assert.deepEqual(ids(workspaceChoices({ account: { role: 'admin', localCustomer: true, orgId: 'customer-one-00000000' }, catalog })), ['customer-one-00000000']));
check('no host or name grants management', () => assert.equal(hasWorkspaceDirectoryAccess({ role: 'admin', name: 'Jordan', label: 'Platform owner' }), false));

const legacy = workspaceDirectory({ account: owner, current: 'occasionally-odd', choices: [...choices, { id: 'phantomforce', name: 'PhantomForce', businessId: 'phantomforce' }, { id: 'phantomforce-owner', name: 'Private records', businessId: 'phantomforce' }] });
check('actual internal organization remains the primary platform choice', () => assert.deepEqual(ids(legacy.primary), expected));
check('legacy namespace is preserved behind management', () => assert.ok(ids(legacy.other).includes('phantomforce-owner')));
check('same-profile alternate organization is not merged', () => assert.ok(ids(legacy.other).includes('phantomforce')));
const mapped = workspaceDirectory({ account: owner, choices: [{ id: 'actual-custom-org', name: 'Configured business', businessId: 'custom-production-profile' }] });
check('explicit server business profile supports additional real businesses', () => assert.deepEqual(ids(mapped.primary), ['actual-custom-org']));
const spoofed = workspaceDirectory({ account: owner, choices: [{ id: 'unconfigured-org', name: 'PhantomForce' }] });
check('display name alone cannot promote a workspace into the normal business picker', () => assert.equal(spoofed.primary.length, 0));
console.log(`Workspace directory: ${checks} checks passed (primary businesses, preserved organizations, exact IDs, duplicate labels, search, active scope and ordinary customer memberships).`);
