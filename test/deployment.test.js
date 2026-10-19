import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectionUri } from '../server.js';

test('部署时从密码文件建立 MongoDB 连接且正确编码特殊字符', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'survey-deploy-'));
  const secret = join(dir, 'password');
  await writeFile(secret, 'a+b/c?d\n');
  const keys = ['MONGODB_URI', 'MONGO_APP_PASSWORD_FILE', 'MONGO_APP_USER', 'MONGO_HOST', 'MONGO_PORT', 'DB_NAME'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(async () => {
    for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key];
    await rm(dir, { recursive: true, force: true });
  });
  delete process.env.MONGODB_URI;
  Object.assign(process.env, { MONGO_APP_PASSWORD_FILE: secret, MONGO_APP_USER: 'survey_app', MONGO_HOST: 'mongo', MONGO_PORT: '27017', DB_NAME: 'survey_course' });
  assert.equal(await connectionUri(), 'mongodb://survey_app:a%2Bb%2Fc%3Fd@mongo:27017/survey_course?authSource=survey_course');
});
