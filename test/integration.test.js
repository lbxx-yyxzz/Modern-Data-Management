import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient, ObjectId } from 'mongodb';
import { createSurveyServer, ensureIndexes } from '../server.js';

test('注册、问卷发布、权限、匿名、重复提交及统计', async (t) => {
  const client = new MongoClient(process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018', { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  const db = client.db(`survey_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  await ensureIndexes(db);
  const server = createSurveyServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await db.dropDatabase(); await client.close(); });

  async function request(path, { method = 'GET', json, cookie } = {}) {
    const response = await fetch(base + path, { method, headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: json ? JSON.stringify(json) : undefined });
    const setCookie = response.headers.get('set-cookie');
    return { status: response.status, data: await response.json(), cookie: setCookie?.split(';')[0], setCookie };
  }
  async function register(username) {
    const result = await request('/api/register', { method: 'POST', json: { username, password: 'safe-pass-123' } });
    assert.equal(result.status, 201);
    return result.cookie;
  }

  const owner = await register('owner_test');
  const alice = await register('alice_test');
  const bob = await register('bob_test');
  const charlie = await register('charlie_test');
  assert.equal((await request('/api/login', { method: 'POST', json: { username: 'owner_test', password: 'wrong-pass' } })).status, 401);
  const oldCookieSecure = process.env.COOKIE_SECURE;
  process.env.COOKIE_SECURE = '1';
  t.after(() => { oldCookieSecure === undefined ? delete process.env.COOKIE_SECURE : process.env.COOKIE_SECURE = oldCookieSecure; });
  const signedIn = await request('/api/login', { method: 'POST', json: { username: 'owner_test', password: 'safe-pass-123' } });
  assert.equal(signedIn.status, 200);
  assert.match(signedIn.setCookie, /; Secure/);
  oldCookieSecure === undefined ? delete process.env.COOKIE_SECURE : process.env.COOKIE_SECURE = oldCookieSecure;
  assert.equal((await request('/api/me', { cookie: signedIn.cookie })).data.user.username, 'owner_test');
  assert.equal((await request('/api/logout', { method: 'POST', cookie: signedIn.cookie })).status, 200);
  assert.equal((await request('/api/me', { cookie: signedIn.cookie })).data.user, null);
  const created = await request('/api/surveys', { method: 'POST', cookie: owner, json: { title: '课程问卷', description: '用于集成测试', allowAnonymous: true, allowMultipleResponses: false } });
  assert.equal(created.status, 201);
  assert.equal((await request('/api/surveys', { method: 'POST', cookie: owner, json: { title: '另一份草稿' } })).status, 201);
  const id = created.data.id;
  assert.match(id, /^[a-f0-9]{24}$/);
  assert.equal((await request('/api/surveys', { cookie: alice })).data.surveys.length, 0);
  assert.equal((await request(`/api/surveys/${id}`, { cookie: alice })).status, 404);

  const questions = [
    { id: 'q1', title: '是否跳题', type: 'single', required: true, options: [{ id: 'opt_a', label: '跳过' }, { id: 'opt_b', label: '继续' }], validation: {}, jumps: [{ operator: 'equals', value: 'opt_a', target: 'q3' }] },
    { id: 'q2', title: '喜好', type: 'multiple', required: true, options: [{ id: 'opt_x', label: '阅读' }, { id: 'opt_y', label: '运动' }], validation: { minSelections: 2, maxSelections: 2 }, jumps: [] },
    { id: 'q3', title: '年龄', type: 'number', required: true, options: [], validation: { min: 0, max: 120, integerOnly: true }, jumps: [] },
    { id: 'q4', title: '留言', type: 'text', required: false, options: [], validation: { minLength: 0, maxLength: 100 }, jumps: [] },
  ];
  assert.equal((await request(`/api/surveys/${id}/questions`, { method: 'PUT', cookie: owner, json: { questions } })).status, 200);
  const published = await request(`/api/surveys/${id}/publish`, { method: 'POST', cookie: owner });
  assert.equal(published.status, 200);
  const slug = published.data.slug;
  assert.equal((await request(`/api/surveys/${id}`, { method: 'PATCH', cookie: owner, json: { title: '修改' } })).status, 409);
  assert.equal((await request(`/api/public/surveys/${slug}`)).status, 401);

  const invalid = await request(`/api/public/surveys/${slug}/responses`, { method: 'POST', cookie: alice, json: { isAnonymous: true, answers: { q1: 'opt_a', q2: ['opt_x', 'opt_y'], q3: 20 } } });
  assert.equal(invalid.status, 400);
  const anonymous = await request(`/api/public/surveys/${slug}/responses`, { method: 'POST', cookie: alice, json: { isAnonymous: true, answers: { q1: 'opt_a', q3: 20, q4: '匿名留言' } } });
  assert.equal(anonymous.status, 201);
  assert.equal((await request(`/api/public/surveys/${slug}/responses`, { method: 'POST', cookie: alice, json: { isAnonymous: false, answers: { q1: 'opt_a', q3: 20 } } })).status, 409);
  assert.equal((await request(`/api/public/surveys/${slug}/responses`, { method: 'POST', cookie: bob, json: { isAnonymous: false, answers: { q1: 'opt_b', q2: ['opt_x', 'opt_y'], q3: 30, q4: '实名留言' } } })).status, 201);

  const concurrent = await Promise.all([1, 2].map(() => request(`/api/public/surveys/${slug}/responses`, { method: 'POST', cookie: charlie, json: { answers: { q1: 'opt_a', q3: 40 } } })));
  assert.deepEqual(concurrent.map((item) => item.status).sort(), [201, 409]);

  const stats = await request(`/api/surveys/${id}/stats`, { cookie: owner });
  assert.equal(stats.status, 200);
  assert.equal(stats.data.totalResponses, 3);
  assert.equal(stats.data.questions[0].options[0].count, 2);
  assert.equal(stats.data.questions[1].answeredCount, 1);
  assert.equal(stats.data.questions[2].average, 30);
  assert.equal(stats.data.questions[3].values.find((item) => item.value === '匿名留言').respondentName, null);
  assert.equal(stats.data.questions[3].values.find((item) => item.value === '实名留言').respondentName, 'bob_test');
  assert.ok(!JSON.stringify(stats.data).includes('alice_test'));
  const singleStats = await request(`/api/surveys/${id}/questions/q3/stats`, { cookie: owner });
  assert.equal(singleStats.status, 200);
  assert.equal(singleStats.data.question.average, 30);
  const stored = await db.collection('responses').findOne({ surveyId: new ObjectId(id), isAnonymous: true });
  assert.ok(stored.respondentId instanceof ObjectId);
  assert.equal((await request(`/api/surveys/${id}/stats`, { cookie: alice })).status, 404);
  assert.equal((await request(`/api/surveys/${id}/close`, { method: 'POST', cookie: owner })).status, 200);
  assert.equal((await request(`/api/public/surveys/${slug}/responses`, { method: 'POST', cookie: bob, json: { answers: { q1: 'opt_a', q3: 30 } } })).status, 409);

  const repeatSurvey = await request('/api/surveys', { method: 'POST', cookie: owner, json: { title: '可重复问卷', allowMultipleResponses: true, allowAnonymous: false } });
  const repeatId = repeatSurvey.data.id;
  assert.equal((await request(`/api/surveys/${repeatId}/questions`, { method: 'PUT', cookie: owner, json: { questions: [questions[0]] } })).status, 400);
  const simpleQuestion = { ...questions[0], jumps: [] };
  assert.equal((await request(`/api/surveys/${repeatId}/questions`, { method: 'PUT', cookie: owner, json: { questions: [simpleQuestion] } })).status, 200);
  const repeatSlug = (await request(`/api/surveys/${repeatId}/publish`, { method: 'POST', cookie: owner })).data.slug;
  assert.equal((await request(`/api/public/surveys/${repeatSlug}/responses`, { method: 'POST', cookie: alice, json: { isAnonymous: true, answers: { q1: 'opt_a' } } })).status, 400);
  assert.equal((await request(`/api/public/surveys/${repeatSlug}/responses`, { method: 'POST', cookie: alice, json: { answers: { q1: 'opt_a' } } })).status, 201);
  assert.equal((await request(`/api/public/surveys/${repeatSlug}/responses`, { method: 'POST', cookie: alice, json: { answers: { q1: 'opt_b' } } })).status, 201);
  const repeatStats = await request(`/api/surveys/${repeatId}/stats`, { cookie: owner });
  assert.equal(repeatStats.data.questions[0].answeredCount, 2);
  assert.equal(repeatStats.data.questions[0].respondentCount, 1);
  assert.deepEqual(repeatStats.data.questions[0].options.map((option) => option.respondentCount), [1, 1]);

  const expiredSurvey = await request('/api/surveys', { method: 'POST', cookie: owner, json: { title: '过期问卷', deadline: '2020-01-01T00:00:00.000Z' } });
  assert.equal(expiredSurvey.status, 201);
  assert.equal((await request(`/api/surveys/${expiredSurvey.data.id}/questions`, { method: 'PUT', cookie: owner, json: { questions: [simpleQuestion] } })).status, 200);
  assert.equal((await request(`/api/surveys/${expiredSurvey.data.id}/publish`, { method: 'POST', cookie: owner })).status, 400);
  await db.collection('surveys').updateOne({ _id: new ObjectId(repeatId) }, { $set: { deadline: new Date('2020-01-01T00:00:00.000Z') } });
  assert.equal((await request(`/api/public/surveys/${repeatSlug}/responses`, { method: 'POST', cookie: bob, json: { answers: { q1: 'opt_a' } } })).status, 409);
});
