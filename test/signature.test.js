'use strict';
// Signature verification uses the same format Tenderely signs deliveries with.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { verifySignature } = require('../dist/nodes/TenderelyTrigger/TenderelyTrigger.node.js');

const sign = (secret, body, t) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const now = 1_800_000_000;
const body = JSON.stringify({ event: 'record.created', record: { id: 'a', data: { name: 'Çağrı' } } });

test('accepts a valid signature (Buffer and string)', () => {
    const h = sign('secret', body, now);
    assert.strictEqual(verifySignature('secret', h, Buffer.from(body), now), true);
    assert.strictEqual(verifySignature('secret', h, body, now), true);
});
test('rejects a changed body, a wrong secret and an empty secret', () => {
    const h = sign('secret', body, now);
    assert.strictEqual(verifySignature('secret', h, body.replace('Çağrı', 'Cagri'), now), false);
    assert.strictEqual(verifySignature('other', h, body, now), false);
    assert.strictEqual(verifySignature('', h, body, now), false);
});
test('rejects timestamps more than 5 minutes off', () => {
    assert.strictEqual(verifySignature('secret', sign('secret', body, now - 301), body, now), false);
    assert.strictEqual(verifySignature('secret', sign('secret', body, now + 301), body, now), false);
    assert.strictEqual(verifySignature('secret', sign('secret', body, now - 299), body, now), true);
});
test('rejects malformed headers', () => {
    for (const h of [undefined, '', 'v1=abc', 't=x,v1=abc', `t=${now}`, `t=${now},v1=zz`, `t=${now},v1=${'0'.repeat(64)}`]) {
        assert.strictEqual(verifySignature('secret', h, body, now), false, String(h));
    }
});
