import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scrypt as scryptCallback, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { MongoClient, ObjectId } from 'mongodb';
import { InputError, normalizeSurvey, normalizeQuestions, validateSubmission } from './validation.js';

const scrypt = promisify(scryptCallback);
const publicDir = join(dirname(fileURLToPath(import.meta.url)), 'public');
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function reply(response, status, data, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(data));
}

async function body(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new InputError('请发送 JSON 数据', 415);
  let content = '';
  for await (const chunk of request) {
    content += chunk;
    if (content.length > 1024 * 1024) throw new InputError('请求内容过大', 413);
  }
  try {
    const parsed = JSON.parse(content || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parsed;
  } catch { throw new InputError('JSON 格式不正确'); }
}

function cookie(request, name) {
  const pair = (request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return pair?.slice(name.length + 1) || null;
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`) throw new InputError('请求来源不允许', 403);
}

function oid(value) {
  if (!ObjectId.isValid(value) || String(new ObjectId(value)) !== value) throw new InputError('无效的问卷编号');
  return new ObjectId(value);
}

function surveyView(survey) {
  return {
    id: String(survey._id), title: survey.title, description: survey.description,
    allowAnonymous: survey.allowAnonymous, allowMultipleResponses: survey.allowMultipleResponses,
    status: survey.status, deadline: survey.deadline, slug: survey.slug,
    questions: survey.questions, createdAt: survey.createdAt, updatedAt: survey.updatedAt,
  };
}

function isOpen(survey) {
  return survey.status === 'published' && (!survey.deadline || new Date(survey.deadline) > new Date());
}

async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [salt, hex] = stored.split(':');
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = await scrypt(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sessionCookie(token, maxAge) {
  return `survey_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`;
}

export async function connectionUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  if (process.env.MONGO_APP_PASSWORD_FILE) {
    const password = (await readFile(process.env.MONGO_APP_PASSWORD_FILE, 'utf8')).trim();
    if (!password) throw new Error('MongoDB 应用密码文件为空');
    const username = encodeURIComponent(process.env.MONGO_APP_USER || 'survey_app');
    const dbName = encodeURIComponent(process.env.DB_NAME || 'survey_course');
    const host = process.env.MONGO_HOST || 'mongo';
    const port = process.env.MONGO_PORT || '27017';
    return `mongodb://${username}:${encodeURIComponent(password)}@${host}:${port}/${dbName}?authSource=${dbName}`;
  }
  return 'mongodb://127.0.0.1:27017';
}

async function makeSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await db.collection('sessions').insertOne({ tokenHash, userId, expiresAt: new Date(Date.now() + SESSION_MS) });
  return token;
}

async function signedInUser(db, request) {
  const token = cookie(request, 'survey_session');
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const session = await db.collection('sessions').findOne({ tokenHash, expiresAt: { $gt: new Date() } });
  if (!session) return null;
  return db.collection('users').findOne({ _id: session.userId }, { projection: { username: 1, createdAt: 1 } });
}

async function requireUser(db, request) {
  const user = await signedInUser(db, request);
  if (!user) throw new InputError('请先登录', 401);
  return user;
}

async function ownedSurvey(db, id, userId) {
  const survey = await db.collection('surveys').findOne({ _id: oid(id), ownerId: userId });
  if (!survey) throw new InputError('未找到此问卷', 404);
  return survey;
}

function calculateStats(survey, responses, names) {
  const questions = survey.questions.map((question) => {
    const values = responses.map((response) => ({ response, value: response.answers[question.id] })).filter((item) => item.value !== undefined);
    const base = {
      id: question.id, title: question.title, type: question.type,
      answeredCount: values.length,
      respondentCount: new Set(values.map(({ response }) => String(response.respondentId))).size,
    };
    if (question.type === 'single' || question.type === 'multiple') {
      base.options = question.options.map((option) => {
        const selected = values.filter((item) => question.type === 'single' ? item.value === option.id : item.value.includes(option.id));
        return { id: option.id, label: option.label, count: selected.length, respondentCount: new Set(selected.map(({ response }) => String(response.respondentId))).size };
      });
    } else {
      base.values = values.map(({ response, value }) => ({ value, submittedAt: response.submittedAt, respondentName: response.isAnonymous ? null : names.get(String(response.respondentId)) || null }));
      if (question.type === 'number') base.average = values.length ? values.reduce((sum, item) => sum + item.value, 0) / values.length : null;
    }
    return base;
  });
  return {
    survey: surveyView(survey), totalResponses: responses.length, questions,
    submissions: responses.map((response) => ({ submittedAt: response.submittedAt, isAnonymous: response.isAnonymous, respondentName: response.isAnonymous ? null : names.get(String(response.respondentId)) || null })),
  };
}

async function api(db, request, response, pathname) {
  const method = request.method;
  if (!['GET', 'HEAD'].includes(method)) sameOrigin(request);
  if (pathname === '/api/me' && method === 'GET') {
    const user = await signedInUser(db, request);
    return reply(response, 200, { user: user ? { id: String(user._id), username: user.username } : null });
  }
  if (pathname === '/api/register' && method === 'POST') {
    const input = await body(request);
    const username = String(input.username || '').trim();
    const password = String(input.password || '');
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{3,24}$/.test(username)) throw new InputError('用户名需为 3–24 位汉字、字母、数字或下划线');
    if (password.length < 8 || password.length > 128) throw new InputError('密码需为 8–128 位');
    let user;
    try { user = await db.collection('users').insertOne({ username, passwordHash: await hashPassword(password), createdAt: new Date() }); }
    catch (error) { if (error.code === 11000) throw new InputError('用户名已存在', 409); throw error; }
    const token = await makeSession(db, user.insertedId);
    return reply(response, 201, { user: { id: String(user.insertedId), username } }, { 'Set-Cookie': sessionCookie(token, Math.floor(SESSION_MS / 1000)) });
  }
  if (pathname === '/api/login' && method === 'POST') {
    const input = await body(request);
    const user = await db.collection('users').findOne({ username: String(input.username || '').trim() });
    if (!user || !(await verifyPassword(String(input.password || ''), user.passwordHash))) throw new InputError('用户名或密码错误', 401);
    const token = await makeSession(db, user._id);
    return reply(response, 200, { user: { id: String(user._id), username: user.username } }, { 'Set-Cookie': sessionCookie(token, Math.floor(SESSION_MS / 1000)) });
  }
  if (pathname === '/api/logout' && method === 'POST') {
    const token = cookie(request, 'survey_session');
    if (token) await db.collection('sessions').deleteOne({ tokenHash: createHash('sha256').update(token).digest('hex') });
    return reply(response, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (pathname === '/api/surveys' && method === 'GET') {
    const user = await requireUser(db, request);
    const surveys = await db.collection('surveys').find({ ownerId: user._id }).sort({ createdAt: -1 }).toArray();
    return reply(response, 200, { surveys: surveys.map(surveyView) });
  }
  if (pathname === '/api/surveys' && method === 'POST') {
    const user = await requireUser(db, request);
    const data = normalizeSurvey(await body(request));
    const now = new Date();
    const result = await db.collection('surveys').insertOne({ ...data, ownerId: user._id, status: 'draft', questions: [], createdAt: now, updatedAt: now });
    return reply(response, 201, { id: String(result.insertedId) });
  }

  const questionStatsMatch = pathname.match(/^\/api\/surveys\/([a-f0-9]{24})\/questions\/([a-zA-Z0-9_-]{2,80})\/stats$/);
  if (questionStatsMatch && method === 'GET') {
    const user = await requireUser(db, request);
    const survey = await ownedSurvey(db, questionStatsMatch[1], user._id);
    if (!survey.questions.some((question) => question.id === questionStatsMatch[2])) throw new InputError('未找到此题目', 404);
    const responses = await db.collection('responses').find({ surveyId: survey._id }).toArray();
    const visibleIds = [...new Map(responses.filter((item) => !item.isAnonymous).map((item) => [String(item.respondentId), item.respondentId])).values()];
    const users = visibleIds.length ? await db.collection('users').find({ _id: { $in: visibleIds } }, { projection: { username: 1 } }).toArray() : [];
    const names = new Map(users.map((item) => [String(item._id), item.username]));
    const stats = calculateStats(survey, responses, names);
    return reply(response, 200, { surveyId: String(survey._id), question: stats.questions.find((question) => question.id === questionStatsMatch[2]) });
  }

  const ownerMatch = pathname.match(/^\/api\/surveys\/([a-f0-9]{24})(?:\/(questions|publish|close|stats))?$/);
  if (ownerMatch) {
    const user = await requireUser(db, request);
    const survey = await ownedSurvey(db, ownerMatch[1], user._id);
    const action = ownerMatch[2];
    if (!action && method === 'GET') return reply(response, 200, { survey: surveyView(survey) });
    if (!action && method === 'PATCH') {
      if (survey.status !== 'draft') throw new InputError('发布后不能修改问卷', 409);
      const data = normalizeSurvey(await body(request));
      await db.collection('surveys').updateOne({ _id: survey._id }, { $set: { ...data, updatedAt: new Date() } });
      return reply(response, 200, { ok: true });
    }
    if (action === 'questions' && method === 'PUT') {
      if (survey.status !== 'draft') throw new InputError('发布后不能修改题目', 409);
      const input = await body(request);
      const questions = normalizeQuestions(input.questions);
      await db.collection('surveys').updateOne({ _id: survey._id }, { $set: { questions, updatedAt: new Date() } });
      return reply(response, 200, { ok: true });
    }
    if (action === 'publish' && method === 'POST') {
      if (survey.status !== 'draft') throw new InputError('只有草稿能发布', 409);
      if (!survey.questions.length) throw new InputError('发布前至少添加一道题目');
      if (survey.deadline && new Date(survey.deadline) <= new Date()) throw new InputError('截止时间必须晚于现在');
      const slug = randomBytes(8).toString('base64url');
      await db.collection('surveys').updateOne({ _id: survey._id, status: 'draft' }, { $set: { status: 'published', slug, updatedAt: new Date() } });
      return reply(response, 200, { slug, url: `/survey/${slug}` });
    }
    if (action === 'close' && method === 'POST') {
      if (survey.status !== 'published') throw new InputError('只有已发布的问卷能关闭', 409);
      await db.collection('surveys').updateOne({ _id: survey._id }, { $set: { status: 'closed', updatedAt: new Date() } });
      return reply(response, 200, { ok: true });
    }
    if (action === 'stats' && method === 'GET') {
      const responses = await db.collection('responses').find({ surveyId: survey._id }).sort({ submittedAt: -1 }).toArray();
      const visibleIds = [...new Map(responses.filter((item) => !item.isAnonymous).map((item) => [String(item.respondentId), item.respondentId])).values()];
      const users = visibleIds.length ? await db.collection('users').find({ _id: { $in: visibleIds } }, { projection: { username: 1 } }).toArray() : [];
      const names = new Map(users.map((item) => [String(item._id), item.username]));
      return reply(response, 200, calculateStats(survey, responses, names));
    }
  }

  const publicMatch = pathname.match(/^\/api\/public\/surveys\/([A-Za-z0-9_-]{8,32})(?:\/responses)?$/);
  if (publicMatch) {
    const user = await requireUser(db, request);
    const survey = await db.collection('surveys').findOne({ slug: publicMatch[1], status: { $in: ['published', 'closed'] } });
    if (!survey) throw new InputError('未找到此问卷', 404);
    if (pathname.endsWith('/responses') && method === 'POST') {
      if (!isOpen(survey)) throw new InputError('问卷已关闭或超过截止时间', 409);
      const input = await body(request);
      const isAnonymous = input.isAnonymous === true;
      if (isAnonymous && !survey.allowAnonymous) throw new InputError('此问卷不允许匿名填写');
      const answers = validateSubmission(survey.questions, input.answers);
      const responseData = { surveyId: survey._id, respondentId: user._id, isAnonymous, answers, submittedAt: new Date() };
      if (!survey.allowMultipleResponses) responseData.dedupeKey = `${survey._id}:${user._id}`;
      try { await db.collection('responses').insertOne(responseData); }
      catch (error) { if (error.code === 11000) throw new InputError('此问卷不允许重复提交', 409); throw error; }
      return reply(response, 201, { ok: true });
    }
    if (method === 'GET' && !pathname.endsWith('/responses')) {
      const alreadyResponded = !survey.allowMultipleResponses && !!(await db.collection('responses').findOne({ surveyId: survey._id, respondentId: user._id }, { projection: { _id: 1 } }));
      return reply(response, 200, { survey: { ...surveyView(survey), open: isOpen(survey) }, alreadyResponded });
    }
  }
  throw new InputError('接口不存在', 404);
}

export async function ensureIndexes(db) {
  await Promise.all([
    db.collection('users').createIndex({ username: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('surveys').createIndex({ ownerId: 1, createdAt: -1 }),
    db.collection('surveys').createIndex({ slug: 1 }, { unique: true, sparse: true }),
    db.collection('responses').createIndex({ surveyId: 1, submittedAt: -1 }),
    db.collection('responses').createIndex({ dedupeKey: 1 }, { unique: true, sparse: true }),
  ]);
}

export function createSurveyServer(db) {
  return createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
      if (pathname.startsWith('/api/')) return await api(db, request, response, pathname);
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new InputError('页面请求方法不支持', 405);
      const asset = pathname === '/app.js' ? 'app.js' : pathname === '/ids.js' ? 'ids.js' : pathname === '/styles.css' ? 'styles.css' : 'index.html';
      const mime = asset.endsWith('.js') ? 'text/javascript; charset=utf-8' : asset.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
      const data = await readFile(join(publicDir, asset));
      response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (!(error instanceof InputError)) console.error(error);
      reply(response, error instanceof InputError ? error.status : 500, { error: error instanceof InputError ? error.message : '服务器暂时无法处理请求' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const client = new MongoClient(await connectionUri(), { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'survey_course');
    await ensureIndexes(db);
    const server = createSurveyServer(db);
    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || '127.0.0.1';
    server.listen(port, host, () => console.log(`问卷系统已启动：http://${host}:${port}`));
  } catch (error) {
    console.error('启动失败：无法连接 MongoDB。', error.message);
    await client.close();
    process.exitCode = 1;
  }
}
