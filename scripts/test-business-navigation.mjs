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
console.log('Business navigation: module coverage, permissions, single CRM/customer entry, legacy links and supporting tools passed.');
