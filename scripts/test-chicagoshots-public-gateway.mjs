import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync('ops/admin-live/admin-static-server.mjs','utf8');const fn=source.match(/function shouldProxy\(urlPath\) \{[\s\S]*?\n\}/)[0];const context={};vm.createContext(context);vm.runInContext(fn,context);
for(const route of ['/api/public/chicagoshots/inquiries','/api/public/chicagoshots/website-events'])assert.equal(context.shouldProxy(route),true);
for(const route of ['/api/public/other','/api/public/chicagoshots/inquiries/private','/api/public/chicagoshots/website-events/private'])assert.equal(context.shouldProxy(route),false);
console.log('PASS exact public ChicagoShots gateway routes');
