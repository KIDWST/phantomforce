import assert from 'node:assert/strict';
import { businessNavigation, getBusinessProfile, businessCanOpenRoute } from '../app/js/business-profiles.js';
const base = ['dashboard','leads','clients','followup','clientsetup','business-crm','money','analytics','phantomplay','phantomstore','developer','settings'].map(id=>({id,label:id,ownerOnly:id==='settings',adminOnly:id==='clientsetup'}));
const odd = businessNavigation('occasionally-odd',base);
const studio = businessNavigation('client-chicagoshots',base);
const platform = businessNavigation('phantomforce',base);
for (const route of ['orders','products','production','inventory','customers','channels','shipping','marketing','finance','analytics']) assert.ok(odd.some(r=>r.id===`business-${route}`),route);
for (const route of ['bookings','calendar','projects','deliverables','gear']) assert.ok(studio.some(r=>r.id===`business-${route}`),route);
for (const items of [odd,studio]) {
  assert.equal(items.some(r=>['phantomplay','phantomstore','developer'].includes(r.id)),false);
  assert.equal(items.find(r=>r.id==='settings').ownerOnly,true);
}
assert.equal(businessCanOpenRoute('client-chicagoshots','business-inventory'),false);
assert.equal(businessCanOpenRoute('occasionally-odd','business-gear'),false);
assert.equal(studio.find(r=>r.id==='money').label,'Invoices');
assert.equal(getBusinessProfile({id:'mapped-odd',businessProfileId:'occasionallyodd'}).id,'occasionally-odd');
for (const id of ['phantomforce-internal','phantomforce-owner']) assert.equal(getBusinessProfile(id).id,'phantomforce', 'Reserved existing platform organization IDs use the original command-center profile even before catalog loading.');
assert.equal(getBusinessProfile({id:'org-unrelated',name:'PhantomForce'}).id,'org-unrelated', 'A display name cannot select another organization profile.');
assert.equal(odd.some(r=>r.id==='chicagoshots'),false);
for (const items of [studio,platform]) {
  assert.deepEqual(items.filter(r=>['leads','clients','followup','business-crm'].includes(r.id)).map(r=>[r.id,r.label]),[['leads','CRM']], 'One CRM destination owns the shared relationship records.');
}
assert.deepEqual(odd.filter(r=>['leads','clients','followup','business-crm','business-customers'].includes(r.id)).map(r=>[r.id,r.label]),[['business-customers','Customers']], 'Commerce customers have one dedicated destination.');
assert.equal(platform.find(r=>r.id==='clientsetup').adminOnly,true, 'Distinct administration retains its permission flag.');
assert.equal(businessCanOpenRoute('client-chicagoshots','business-crm'),true, 'Existing studio CRM bookmarks still resolve.');
assert.equal(businessCanOpenRoute('occasionally-odd','business-crm'),false, 'Studio CRM bookmarks cannot open in commerce.');
for (const items of [studio,platform,odd]) {
  assert.equal(items.find(r=>r.id==='dashboard').label,'Overview');
  for (const [id,label] of [['business-templates','Templates'],['business-assets','Files'],['business-channels','Channels']]) {
    assert.equal(items.find(r=>r.id===id)?.label,label, 'Supporting tools remain discoverable in navigation.');
  }
  assert.equal(new Set(items.map(r=>r.id)).size,items.length, 'Every destination appears once.');
}
const operatorTools = [
  { id: 'adminos', label: 'Admin', adminOnly: true },
  { id: 'developer', label: 'Developer', ownerOnly: true },
  { id: 'runtime', label: 'Runtime & Devices', internalOnly: true },
  { id: 'workers', label: 'Workforce', dashboardWidget: true },
  ...['vacation', 'phantomplay', 'phantomstore', 'audit', 'planner', 'intelligence'].map(id => ({ id, label: id })),
];
for (const business of ['phantomforce', 'occasionally-odd', 'client-chicagoshots', 'other-business']) {
  const restored = businessNavigation(business, [...base.filter(item => !operatorTools.some(tool => tool.id === item.id)), ...operatorTools], { operator: true });
  for (const tool of operatorTools) {
    const item = restored.find(item => item.id === tool.id);
    assert.ok(item, `Platform operator keeps ${tool.id} while working in ${business}.`);
    for (const flag of ['adminOnly', 'ownerOnly', 'internalOnly', 'dashboardWidget']) assert.equal(item[flag], tool[flag], `${tool.id} retains ${flag}.`);
  }
  assert.equal(new Set(restored.map(item => item.id)).size, restored.length, 'Restoring operator tools adds no duplicate navigation.');
  assert.equal(restored.find(item => item.id === 'dashboard').label, 'Command center', 'The original owner home stays recognizable across businesses.');
  assert.ok(restored.some(item => item.id === 'business-overview'), 'The focused business overview remains available alongside the full console.');
}
const operatorOdd = businessNavigation('occasionally-odd', [...base, ...operatorTools], { operator: true });
assert.equal(operatorOdd.some(item => item.id === 'business-gear'), false, 'Operator discovery does not mix studio records into commerce.');
assert.equal(operatorOdd.some(item => item.id === 'business-production'), true, 'Commerce production survives full operator navigation.');
assert.deepEqual(operatorOdd.filter(item => ['leads', 'clients', 'followup', 'business-crm', 'business-customers'].includes(item.id)).map(item => item.id), ['business-customers'], 'Platform operators retain one dedicated commerce customer destination.');
const operatorStudio = businessNavigation('client-chicagoshots', [...base, ...operatorTools], { operator: true });
assert.equal(operatorStudio.some(item => item.id === 'business-inventory'), false, 'Operator discovery does not mix commerce records into studio.');
assert.equal(operatorStudio.find(item => item.id === 'money').label, 'Invoices', 'Business labels retain their context for the platform owner.');
for (const business of ['occasionally-odd', 'client-chicagoshots']) {
  const customer = businessNavigation(business, [...base, ...operatorTools], { operator: false });
  for (const tool of operatorTools) assert.equal(customer.some(item => item.id === tool.id), false, `Customer profile does not gain ${tool.id}.`);
}
console.log('Business navigation: module coverage, operator parity, preserved permissions, customer isolation, single CRM/customer entry, legacy links and supporting tools passed.');
