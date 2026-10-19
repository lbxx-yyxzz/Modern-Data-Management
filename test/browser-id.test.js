import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { newId } from '../public/ids.js';

test('局域网 HTTP 环境只有 getRandomValues 时也能生成合法且不重复的题目 ID', () => {
  const insecureContextCrypto = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };
  const ids = Array.from({ length: 100 }, () => newId(insecureContextCrypto));
  assert.equal(new Set(ids).size, ids.length);
  ids.forEach((id) => assert.match(id, /^[a-f0-9]{32}$/));
});
