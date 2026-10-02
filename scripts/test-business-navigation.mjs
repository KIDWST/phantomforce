import assert from 'node:assert/strict';
import { businessNavigation, getBusinessProfile, businessCanOpenRoute } from '../app/js/business-profiles.js';
const base = ['dashboard','leads','money','analytics','phantomplay','phantomstore','developer','settings'].map(id=>({id,label:id,ownerOnly:id==='settings'}));
const odd = businessNavigation('occasionally-odd',base);
const studio = businessNavigation('client-chicagoshots',base);
for (const route of ['orders','products','production','inventory','customers','channels','shipping','marketing','finance','analytics']) assert.ok(odd.some(r=>r.id===`business-${route}`),route);
for (const route of ['bookings','calendar','projects','deliverables','gear','crm']) assert.ok(studio.some(r=>r.id===`business-${route}`),route);
for (const items of [odd,studio]) {
  assert.equal(items.some(r=>['phantomplay','phantomstore','developer'].includes(r.id)),false);
  assert.equal(items.find(r=>r.id==='settings').ownerOnly,true);
}
assert.equal(businessCanOpenRoute('client-chicagoshots','business-inventory'),false);
assert.equal(businessCanOpenRoute('occasionally-odd','business-gear'),false);
assert.equal(studio.find(r=>r.id==='money').label,'Invoices');
assert.equal(getBusinessProfile({id:'mapped-odd',businessProfileId:'occasionallyodd'}).id,'occasionally-odd');
assert.equal(odd.some(r=>r.id==='chicagoshots'),false);
console.log('Business navigation: 25 module, permission, profile and separation checks passed.');
