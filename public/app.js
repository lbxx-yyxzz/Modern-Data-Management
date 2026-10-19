import { newId } from './ids.js';

const app = document.querySelector('#app');
const nav = document.querySelector('#topnav');
const toastNode = document.querySelector('#toast');
const state = { user: null, authMode: 'login', editor: null, fill: null, renderId: 0 };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const dateText = (value) => value ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '未设置';
const statusText = { draft: '草稿', published: '已发布', closed: '已关闭' };
const questionType = { single: '单选题', multiple: '多选题', text: '文本填空', number: '数字填空' };
let toastTimer;

function toast(message, error = false) {
  toastNode.textContent = message;
  toastNode.className = error ? 'visible error' : 'visible';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastNode.className = ''; }, 3500);
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

function navigate(path) {
  history.pushState({}, '', path);
  state.editor = null;
  state.fill = null;
  render();
  window.scrollTo(0, 0);
}

function topnav() {
  nav.innerHTML = state.user
    ? `<a class="nav-link" href="/dashboard" data-link>我的问卷</a><a class="nav-link" href="/surveys/new" data-link>新建问卷</a><span class="nav-user">${esc(state.user.username)}</span><button class="nav-button" data-action="logout">退出</button>`
    : `<a class="nav-link" href="/" data-link>首页</a>`;
}

function pageError(error) {
  app.innerHTML = `<div class="card empty"><div class="empty-icon">!</div><h3>暂时无法打开</h3><p>${esc(error.message)}</p><a class="button secondary" href="/dashboard" data-link>返回首页</a></div>`;
}

function authView() {
  const register = state.authMode === 'register';
  const onSurvey = location.pathname.startsWith('/survey/');
  app.innerHTML = `<div class="auth-layout">
    <section class="auth-hero"><p class="eyebrow">Survey Studio</p><h1 class="page-title">把想知道的，<br>变成清晰的答案。</h1><p>创建问卷、设置逻辑跳转、收集真实回答，并在一个地方查看统计结果。${onSurvey ? '登录后即可继续填写这份问卷。' : ''}</p><div class="feature-row"><div class="feature"><span></span>灵活题型</div><div class="feature"><span></span>条件跳转</div><div class="feature"><span></span>实时统计</div></div></section>
    <section class="card auth-card"><h2>${register ? '创建账号' : '欢迎回来'}</h2><p>${register ? '注册后开始制作你的第一份问卷。' : '登录并继续管理或填写问卷。'}</p><div class="tabs" role="tablist"><button class="tab ${register ? '' : 'active'}" data-action="auth-login" role="tab" aria-selected="${!register}">登录</button><button class="tab ${register ? 'active' : ''}" data-action="auth-register" role="tab" aria-selected="${register}">注册</button></div><form id="auth-form"><div class="field"><label for="username">用户名</label><input class="input" id="username" name="username" autocomplete="username" minlength="3" maxlength="24" required placeholder="请输入用户名"></div><div class="field"><label for="password">密码</label><input class="input" id="password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" minlength="8" required placeholder="至少 8 位"></div><button class="button" type="submit">${register ? '注册并进入' : '登录'}</button></form></section>
  </div>`;
  document.querySelector('#auth-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      const data = await api(register ? '/api/register' : '/api/login', { method: 'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) });
      state.user = data.user;
      toast(register ? '注册成功' : '登录成功');
      if (onSurvey) render(); else navigate('/dashboard');
    } catch (error) { toast(error.message, true); }
  };
}

async function dashboard(renderId) {
  const { surveys } = await api('/api/surveys');
  if (renderId !== state.renderId) return;
  const count = (status) => surveys.filter((item) => item.status === status).length;
  app.innerHTML = `<div class="page-head"><div><p class="eyebrow">Workspace / 我的问卷</p><h1 class="page-title">你好，${esc(state.user.username)}</h1><p class="page-subtitle">从一个好问题开始，收集值得看见的回答。</p></div><div class="page-actions"><a class="button" href="/surveys/new" data-link>＋ 新建问卷</a></div></div>
    <div class="grid grid-3"><div class="card card-pad"><span class="stat-label">全部问卷</span><p class="stat-number">${surveys.length}</p></div><div class="card card-pad"><span class="stat-label">正在收集</span><p class="stat-number">${count('published')}</p></div><div class="card card-pad"><span class="stat-label">草稿待发布</span><p class="stat-number">${count('draft')}</p></div></div>
    <div class="section-header"><h2 class="section-title">我的问卷</h2><span class="muted">共 ${surveys.length} 份</span></div>
    ${surveys.length ? `<div class="survey-list">${surveys.map((survey) => `<article class="card survey-card"><div class="survey-card-top"><div><span class="badge ${survey.status}">${statusText[survey.status]}</span><h3>${esc(survey.title)}</h3><p>${esc(survey.description || '暂无说明')}</p></div></div><div class="survey-card-meta"><span>${survey.questions.length} 道题目</span><span>创建于 ${dateText(survey.createdAt)}</span>${survey.deadline ? `<span>截止 ${dateText(survey.deadline)}</span>` : ''}</div><div class="survey-card-actions"><a class="button small secondary" href="/surveys/${survey.id}/edit" data-link>${survey.status === 'draft' ? '继续编辑' : '查看问卷'}</a><a class="button small ghost" href="/surveys/${survey.id}/results" data-link>统计结果</a>${survey.slug ? `<a class="button small ghost" href="/survey/${survey.slug}" data-link>填写链接 ↗</a>` : ''}</div></article>`).join('')}</div>` : `<div class="card empty"><div class="empty-icon">▤</div><h3>第一份问卷，从这里开始</h3><p>添加题目并发布链接，让回答自动汇集到你的工作台。</p><a class="button" href="/surveys/new" data-link>创建问卷</a></div>`}`;
}

function metadataFields(meta) {
  return `<div class="field"><label for="survey-title">问卷标题</label><input class="input" id="survey-title" data-meta="title" maxlength="120" required value="${esc(meta.title || '')}" placeholder="例如：校园出行方式调查"></div>
    <div class="field"><label for="survey-desc">问卷说明</label><textarea id="survey-desc" data-meta="description" maxlength="2000" placeholder="告诉填写者这份问卷的目的">${esc(meta.description || '')}</textarea></div>
    <div class="field"><label for="survey-deadline">截止时间</label><input class="input" id="survey-deadline" type="datetime-local" data-meta="deadline" value="${meta.deadline ? new Date(meta.deadline).toLocaleString('sv-SE', { hour12: false }).replace(' ', 'T').slice(0, 16) : ''}"><small>留空表示不设置截止时间。</small></div>
    <div class="field"><label class="check-line"><input type="checkbox" data-meta="allowAnonymous" ${meta.allowAnonymous ? 'checked' : ''}><span><strong>允许匿名填写</strong><br>填写者可选择匿名；系统仍保留其账号标识。</span></label></div>
    <div class="field"><label class="check-line"><input type="checkbox" data-meta="allowMultipleResponses" ${meta.allowMultipleResponses ? 'checked' : ''}><span><strong>允许重复提交</strong><br>开启后同一账号可填写多次。</span></label></div>`;
}

function newSurvey() {
  app.innerHTML = `<a class="back-link" href="/dashboard" data-link>← 返回我的问卷</a><div class="page-head"><div><p class="eyebrow">Create / 第一步</p><h1 class="page-title">创建新问卷</h1><p class="page-subtitle">先填写基本信息，下一步添加题目和跳转规则。</p></div></div><div class="form-layout"><form id="new-survey-form" class="card form-card">${metadataFields({})}<div class="form-actions"><button class="button" type="submit">创建并添加题目 →</button></div></form><aside class="card side-note"><h3>开始前的小提示</h3><ul><li>问卷发布前可以反复修改。</li><li>发布后题目和设置将锁定。</li><li>只有登录用户能够填写问卷。</li></ul></aside></div>`;
  document.querySelector('#new-survey-form').onsubmit = async (event) => {
    event.preventDefault();
    const data = readMeta(event.target);
    try { const result = await api('/api/surveys', { method: 'POST', body: JSON.stringify(data) }); navigate(`/surveys/${result.id}/edit`); toast('问卷草稿已创建'); }
    catch (error) { toast(error.message, true); }
  };
}

function readMeta(root) {
  const get = (key) => root.querySelector(`[data-meta="${key}"]`);
  return { title: get('title').value, description: get('description').value, deadline: get('deadline').value ? new Date(get('deadline').value).toISOString() : null, allowAnonymous: get('allowAnonymous').checked, allowMultipleResponses: get('allowMultipleResponses').checked };
}

function newQuestion() {
  return { id: newId(), title: '', type: 'single', required: true, options: [{ id: newId(), label: '选项 1' }, { id: newId(), label: '选项 2' }], validation: {}, jumps: [] };
}

function qField(index, field, value, extra = '') {
  return `<input class="input" data-q="${index}" data-field="${field}" value="${esc(value ?? '')}" ${extra}>`;
}

function questionCard(question, index, questions) {
  const choice = ['single', 'multiple'].includes(question.type);
  const later = questions.slice(index + 1);
  const conditions = question.type === 'number' ? [['eq', '等于'], ['gt', '大于'], ['gte', '大于等于'], ['lt', '小于'], ['lte', '小于等于']] : question.type === 'multiple' ? [['includes', '包含']] : [['equals', '等于']];
  return `<article class="card question-card"><div class="question-card-head"><span class="question-number">${index + 1}</span><strong>第 ${index + 1} 题</strong><div class="question-tools"><button class="icon-button" data-action="q-up" data-index="${index}" title="上移" aria-label="上移第 ${index + 1} 题" ${index === 0 ? 'disabled' : ''}>↑</button><button class="icon-button" data-action="q-down" data-index="${index}" title="下移" aria-label="下移第 ${index + 1} 题" ${index === questions.length - 1 ? 'disabled' : ''}>↓</button><button class="icon-button" data-action="q-remove" data-index="${index}" title="删除" aria-label="删除第 ${index + 1} 题">×</button></div></div>
    <div class="field-row"><div class="field"><label>题目内容</label>${qField(index, 'title', question.title, 'placeholder="请输入题目" maxlength="300"')}</div><div class="field"><label>题型</label><select data-q="${index}" data-field="type">${Object.entries(questionType).map(([value, label]) => `<option value="${value}" ${question.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div></div>
    <label class="check-line"><input type="checkbox" data-q="${index}" data-field="required" ${question.required ? 'checked' : ''}><span>必答题</span></label>
    ${choice ? `<div class="subheading">选项</div>${question.options.map((option, optionIndex) => `<div class="option-row"><span class="muted">${String.fromCharCode(65 + optionIndex)}.</span><input class="input" data-q="${index}" data-option="${optionIndex}" value="${esc(option.label)}" maxlength="120" aria-label="第 ${index + 1} 题选项 ${optionIndex + 1}"><button class="button small ghost" data-action="option-remove" data-index="${index}" data-subindex="${optionIndex}" type="button" ${question.options.length <= 2 ? 'disabled' : ''}>删除</button></div>`).join('')}<button class="button small secondary" data-action="option-add" data-index="${index}" type="button" ${question.options.length >= 20 ? 'disabled' : ''}>＋ 添加选项</button>` : ''}
    ${question.type === 'multiple' ? `<div class="subheading">选择数量</div><div class="inline-controls"><div class="small-field"><span class="muted">最少</span><input class="input" type="number" min="0" data-q="${index}" data-validation="minSelections" value="${esc(question.validation.minSelections ?? 0)}"></div><div class="small-field"><span class="muted">最多</span><input class="input" type="number" min="0" data-q="${index}" data-validation="maxSelections" value="${esc(question.validation.maxSelections ?? question.options.length)}"></div><span class="help">两个数字相同，即必须选固定数量。</span></div>` : ''}
    ${question.type === 'text' ? `<div class="subheading">字数限制</div><div class="inline-controls"><div class="small-field"><span class="muted">最少字数</span><input class="input" type="number" min="0" data-q="${index}" data-validation="minLength" value="${esc(question.validation.minLength ?? 0)}"></div><div class="small-field"><span class="muted">最多字数</span><input class="input" type="number" min="0" data-q="${index}" data-validation="maxLength" value="${esc(question.validation.maxLength ?? 5000)}"></div></div>` : ''}
    ${question.type === 'number' ? `<div class="subheading">数字限制</div><div class="inline-controls"><div class="small-field"><span class="muted">最小值</span><input class="input" type="number" step="any" data-q="${index}" data-validation="min" value="${esc(question.validation.min ?? '')}" placeholder="不限"></div><div class="small-field"><span class="muted">最大值</span><input class="input" type="number" step="any" data-q="${index}" data-validation="max" value="${esc(question.validation.max ?? '')}" placeholder="不限"></div><label class="check-line"><input type="checkbox" data-q="${index}" data-validation="integerOnly" ${question.validation.integerOnly ? 'checked' : ''}>只能输入整数</label></div>` : ''}
    ${question.type !== 'text' ? `<div class="divider"></div><div class="subheading">条件跳转 <span class="help">按顺序匹配；未命中则进入下一题</span></div>${question.jumps.map((rule, ruleIndex) => `<div class="rule-row"><select data-q="${index}" data-jump="${ruleIndex}" data-rule-field="operator">${conditions.map(([value, label]) => `<option value="${value}" ${rule.operator === value ? 'selected' : ''}>${label}</option>`).join('')}</select>${choice ? `<select data-q="${index}" data-jump="${ruleIndex}" data-rule-field="value">${question.options.map((option) => `<option value="${option.id}" ${rule.value === option.id ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select>` : `<input class="input" type="number" step="any" data-q="${index}" data-jump="${ruleIndex}" data-rule-field="value" value="${esc(rule.value)}" placeholder="比较值">`}<span class="muted">→</span><select class="target-select" data-q="${index}" data-jump="${ruleIndex}" data-rule-field="target"><option value="END" ${rule.target === 'END' ? 'selected' : ''}>结束问卷</option>${later.map((target, offset) => `<option value="${target.id}" ${rule.target === target.id ? 'selected' : ''}>第 ${index + offset + 2} 题 · ${esc(target.title || '未命名')}</option>`).join('')}</select><button class="button small ghost" type="button" data-action="jump-remove" data-index="${index}" data-subindex="${ruleIndex}">删除</button></div>`).join('')}<button class="button small secondary" type="button" data-action="jump-add" data-index="${index}">＋ 添加跳转规则</button>` : ''}
  </article>`;
}

function editorPage() {
  const { survey, questions } = state.editor;
  const draft = survey.status === 'draft';
  app.innerHTML = `<a class="back-link" href="/dashboard" data-link>← 返回我的问卷</a><div class="page-head"><div><p class="eyebrow">Survey / ${draft ? '编辑草稿' : '问卷详情'}</p><h1 class="page-title">${esc(survey.title)}</h1><p class="page-subtitle">${draft ? '完成设置和题目后，即可发布分享。' : '问卷已发布，设置与题目已锁定。'}</p></div><div class="page-actions"><a class="button secondary" href="/surveys/${survey.id}/results" data-link>查看统计</a></div></div>
  ${draft ? `<div class="draft-banner"><div><strong>正在编辑草稿</strong><br>发布前可以修改内容；发布后将锁定。</div><button class="button small" data-action="publish">发布问卷</button></div><div class="form-layout"><div><section class="card form-card" id="meta-form"><h2 class="section-title">基本信息</h2>${metadataFields(survey)}<button class="button secondary" data-action="save-meta">保存基本信息</button></section><div class="section-header"><h2 class="section-title">题目设置 <span class="muted">${questions.length} 题</span></h2><button class="button small secondary" data-action="q-add">＋ 添加题目</button></div><div id="question-list">${questions.length ? questions.map((q, i) => questionCard(q, i, questions)).join('') : `<div class="card empty"><h3>还没有题目</h3><p>添加单选、多选或填空题，构成你的问卷。</p><button class="button" data-action="q-add">添加第一题</button></div>`}</div><div class="form-actions"><button class="button" data-action="save-questions">保存题目</button><button class="button secondary" data-action="publish">保存并发布 →</button></div></div><aside class="card side-note"><h3>关于跳转规则</h3><ul><li>可根据单选、多选或数字回答跳到后面的题目。</li><li>多条规则按从上到下的顺序匹配。</li><li>没有匹配时进入下一题。</li></ul></aside></div>` : `<div class="grid grid-2"><div class="card card-pad"><span class="badge ${survey.status}">${statusText[survey.status]}</span><h2 class="section-title" style="margin-top:17px">${esc(survey.title)}</h2><p class="page-subtitle">${esc(survey.description || '暂无说明')}</p><div class="survey-card-meta" style="margin-top:20px"><span>${survey.questions.length} 道题目</span><span>截止：${dateText(survey.deadline)}</span></div></div><div class="card card-pad"><h2 class="section-title">分享问卷</h2><p class="muted">填写者登录后可以通过链接进入问卷。</p><div class="share-box"><input class="input" id="share-url" readonly value="${esc(location.origin + '/survey/' + survey.slug)}"><button class="button secondary" data-action="copy-link">复制</button></div><div class="form-actions"><a class="button secondary" href="/survey/${survey.slug}" data-link>打开问卷</a>${survey.status === 'published' ? `<button class="button danger" data-action="close-survey">关闭问卷</button>` : ''}</div></div></div><div class="section-header"><h2 class="section-title">题目一览</h2></div><div class="survey-list">${survey.questions.map((q, i) => `<div class="card card-pad"><span class="muted">第 ${i + 1} 题 · ${questionType[q.type]}</span><h3>${esc(q.title)}</h3><p class="muted">${q.required ? '必答' : '选答'}${q.jumps.length ? ` · ${q.jumps.length} 条跳转规则` : ''}</p></div>`).join('')}</div>`}`;
}

async function editor(id, renderId) {
  const { survey } = await api(`/api/surveys/${id}`);
  if (renderId !== state.renderId) return;
  state.editor = { survey, questions: structuredClone(survey.questions) };
  editorPage();
}

async function saveMeta() {
  const data = readMeta(document.querySelector('#meta-form'));
  await api(`/api/surveys/${state.editor.survey.id}`, { method: 'PATCH', body: JSON.stringify(data) });
  Object.assign(state.editor.survey, data);
  toast('基本信息已保存');
}

async function saveQuestions() {
  await api(`/api/surveys/${state.editor.survey.id}/questions`, { method: 'PUT', body: JSON.stringify({ questions: state.editor.questions }) });
  toast('题目已保存');
}

function handleEditorInput(target) {
  if (state.editor && target.hasAttribute('data-meta')) {
    state.editor.survey[target.dataset.meta] = target.type === 'checkbox' ? target.checked : target.value;
    return;
  }
  if (!state.editor || !target.hasAttribute('data-q')) return;
  const q = state.editor.questions[Number(target.dataset.q)];
  if (!q) return;
  const value = target.type === 'checkbox' ? target.checked : target.value;
  if (target.dataset.option !== undefined) q.options[Number(target.dataset.option)].label = value;
  else if (target.dataset.validation) q.validation[target.dataset.validation] = value;
  else if (target.dataset.jump !== undefined) q.jumps[Number(target.dataset.jump)][target.dataset.ruleField] = value;
  else if (target.dataset.field) {
    if (target.dataset.field === 'type') {
      q.type = value; q.jumps = []; q.validation = {};
      q.options = ['single', 'multiple'].includes(value) ? [{ id: newId(), label: '选项 1' }, { id: newId(), label: '选项 2' }] : [];
      editorPage();
    } else q[target.dataset.field] = value;
  }
}

async function editorAction(action, button) {
  const index = Number(button.dataset.index);
  const subindex = Number(button.dataset.subindex);
  const { questions, survey } = state.editor;
  if (action === 'save-meta') return saveMeta();
  if (action === 'save-questions') return saveQuestions();
  if (action === 'publish') {
    await saveMeta(); await saveQuestions();
    if (!questions.length) throw new Error('发布前请添加题目');
    await api(`/api/surveys/${survey.id}/publish`, { method: 'POST' });
    toast('问卷已发布，可以分享链接');
    return render();
  }
  if (action === 'close-survey') {
    if (!confirm('关闭后将不能再提交，确定关闭吗？')) return;
    await api(`/api/surveys/${survey.id}/close`, { method: 'POST' });
    toast('问卷已关闭'); return render();
  }
  if (action === 'copy-link') {
    const field = document.querySelector('#share-url');
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(field.value); return toast('链接已复制'); }
      catch { /* 浏览器拒绝自动复制时，允许用户手动复制。 */ }
    }
    field.focus();
    field.select();
    return toast('链接已选中，请按 Ctrl+C（Mac 按 Command+C）复制');
  }
  if (action === 'q-add') questions.push(newQuestion());
  else if (action === 'q-remove') questions.splice(index, 1);
  else if (action === 'q-up') [questions[index - 1], questions[index]] = [questions[index], questions[index - 1]];
  else if (action === 'q-down') [questions[index + 1], questions[index]] = [questions[index], questions[index + 1]];
  else if (action === 'option-add') questions[index].options.push({ id: newId(), label: `选项 ${questions[index].options.length + 1}` });
  else if (action === 'option-remove') {
    const removed = questions[index].options.splice(subindex, 1)[0];
    questions[index].jumps = questions[index].jumps.filter((rule) => rule.value !== removed.id);
  }
  else if (action === 'jump-add') {
    const q = questions[index];
    q.jumps.push({ operator: q.type === 'single' ? 'equals' : q.type === 'multiple' ? 'includes' : 'eq', value: q.type === 'number' ? 0 : q.options[0].id, target: questions[index + 1]?.id || 'END' });
  } else if (action === 'jump-remove') questions[index].jumps.splice(subindex, 1);
  else return;
  questions.forEach((question, questionIndex) => {
    question.jumps.forEach((rule) => {
      if (rule.target !== 'END' && questions.findIndex((item) => item.id === rule.target) <= questionIndex) rule.target = 'END';
    });
  });
  editorPage();
}

function answerHtml(question, previous) {
  if (question.type === 'single' || question.type === 'multiple') {
    return question.options.map((option) => `<label class="fill-option"><input type="${question.type === 'single' ? 'radio' : 'checkbox'}" name="answer" value="${esc(option.id)}" ${(question.type === 'single' ? previous === option.id : Array.isArray(previous) && previous.includes(option.id)) ? 'checked' : ''}><span>${esc(option.label)}</span></label>`).join('');
  }
  if (question.type === 'text') return `<textarea id="answer-text" aria-label="填写答案" placeholder="在这里输入你的回答" maxlength="${question.validation.maxLength}" rows="5">${esc(previous ?? '')}</textarea>`;
  return `<input id="answer-number" class="input" type="number" step="${question.validation.integerOnly ? '1' : 'any'}" value="${esc(previous ?? '')}" ${question.validation.min !== null ? `min="${question.validation.min}"` : ''} ${question.validation.max !== null ? `max="${question.validation.max}"` : ''} placeholder="请输入数字" aria-label="填写数字答案">`;
}

function answerHelp(question) {
  if (question.type === 'multiple') return `最少选择 ${question.validation.minSelections} 项，最多选择 ${question.validation.maxSelections} 项`;
  if (question.type === 'text') return `字数范围：${question.validation.minLength}–${question.validation.maxLength}`;
  if (question.type === 'number') return [question.validation.integerOnly ? '仅整数' : '', question.validation.min !== null ? `最小 ${question.validation.min}` : '', question.validation.max !== null ? `最大 ${question.validation.max}` : ''].filter(Boolean).join(' · ');
  return question.required ? '请选择一个选项' : '可跳过此题';
}

function fillPage() {
  const { survey, alreadyResponded } = state.fill;
  if (!survey.open || alreadyResponded) {
    app.innerHTML = `<div class="fill-wrap"><a class="back-link" href="/dashboard" data-link>← 返回首页</a><div class="card empty"><div class="empty-icon">${alreadyResponded ? '✓' : '⌁'}</div><h3>${alreadyResponded ? '你已经填写过这份问卷' : '问卷已停止收集'}</h3><p>${alreadyResponded ? '创建者未开放重复填写。' : '这份问卷已经关闭，或已超过截止时间。'}</p></div></div>`;
    return;
  }
  const qid = state.fill.path[state.fill.current];
  const index = survey.questions.findIndex((q) => q.id === qid);
  const question = survey.questions[index];
  const percent = Math.max(5, Math.round((index + 1) / survey.questions.length * 100));
  app.innerHTML = `<div class="fill-wrap"><a class="back-link" href="/dashboard" data-link>← 返回首页</a><div class="fill-top"><p class="eyebrow">正在填写问卷</p><h1 class="page-title">${esc(survey.title)}</h1><p class="page-subtitle">${esc(survey.description || '')}</p></div><div class="progress-row"><span>第 ${index + 1} 题 / 共 ${survey.questions.length} 题</span><span>${percent}%</span></div><div class="progress-track"><div class="progress-bar" style="width:${percent}%"></div></div><section class="card fill-card"><span class="muted">${questionType[question.type]}</span><h2>${esc(question.title)}${question.required ? '<span class="required-star">*</span>' : ''}</h2><div class="fill-help">${esc(answerHelp(question))}</div><div style="margin-top:25px">${answerHtml(question, state.fill.answers[qid])}</div>${survey.allowAnonymous ? `<div class="divider"></div><label class="check-line"><input id="anonymous-toggle" type="checkbox" ${state.fill.isAnonymous ? 'checked' : ''}><span>匿名提交：创建者看不到我的用户名</span></label>` : ''}<div class="fill-actions"><button class="button secondary" data-action="fill-back" ${state.fill.current === 0 ? 'disabled' : ''}>← 上一题</button><button class="button" data-action="fill-next">继续 / 提交 →</button></div></section></div>`;
}

async function fill(slug, renderId) {
  const data = await api(`/api/public/surveys/${slug}`);
  if (renderId !== state.renderId) return;
  state.fill = { ...data, path: data.survey.questions.length ? [data.survey.questions[0].id] : [], current: 0, answers: {}, isAnonymous: false };
  fillPage();
}

function readCurrentAnswer(question) {
  if (question.type === 'single') return document.querySelector('input[name="answer"]:checked')?.value ?? null;
  if (question.type === 'multiple') return [...document.querySelectorAll('input[name="answer"]:checked')].map((input) => input.value);
  if (question.type === 'text') return document.querySelector('#answer-text').value.trim();
  const value = document.querySelector('#answer-number').value;
  return value === '' ? null : Number(value);
}

function validateLocal(question, answer) {
  const empty = answer === null || answer === '' || (Array.isArray(answer) && !answer.length);
  if (empty) {
    if (question.required || question.type === 'multiple' && question.validation.minSelections > 0 || question.type === 'text' && question.validation.minLength > 0) throw new Error('请先完成这道题');
    return;
  }
  if (question.type === 'multiple' && (answer.length < question.validation.minSelections || answer.length > question.validation.maxSelections)) throw new Error(answerHelp(question));
  if (question.type === 'text') {
    const length = Array.from(answer).length;
    if (length < question.validation.minLength || length > question.validation.maxLength) throw new Error(answerHelp(question));
  }
  if (question.type === 'number' && (!Number.isFinite(answer) || question.validation.integerOnly && !Number.isInteger(answer) || question.validation.min !== null && answer < question.validation.min || question.validation.max !== null && answer > question.validation.max)) throw new Error(answerHelp(question) || '请输入有效数字');
}

function nextId(questions, index, answer) {
  const matches = (rule) => {
    if (answer === null || answer === '' || Array.isArray(answer) && !answer.length) return false;
    switch (rule.operator) {
      case 'equals': case 'eq': return answer === rule.value;
      case 'includes': return Array.isArray(answer) && answer.includes(rule.value);
      case 'gt': return answer > rule.value;
      case 'gte': return answer >= rule.value;
      case 'lt': return answer < rule.value;
      case 'lte': return answer <= rule.value;
      default: return false;
    }
  };
  return questions[index].jumps.find(matches)?.target || questions[index + 1]?.id || 'END';
}

async function fillNext() {
  const { survey } = state.fill;
  const qid = state.fill.path[state.fill.current];
  const index = survey.questions.findIndex((item) => item.id === qid);
  const question = survey.questions[index];
  const answer = readCurrentAnswer(question);
  validateLocal(question, answer);
  if (answer === null || answer === '' || Array.isArray(answer) && !answer.length) delete state.fill.answers[qid];
  else state.fill.answers[qid] = answer;
  const removed = state.fill.path.splice(state.fill.current + 1);
  for (const id of removed) delete state.fill.answers[id];
  const next = nextId(survey.questions, index, answer);
  if (next !== 'END') {
    state.fill.path.push(next);
    state.fill.current++;
    fillPage();
    return;
  }
  await api(`/api/public/surveys/${survey.slug}/responses`, { method: 'POST', body: JSON.stringify({ isAnonymous: state.fill.isAnonymous, answers: state.fill.answers }) });
  app.innerHTML = `<div class="fill-wrap"><div class="card success-view"><div class="empty-icon">✓</div><h2>提交成功，感谢填写</h2><p>你的回答已经保存。${survey.allowMultipleResponses ? '这份问卷允许再次填写。' : ''}</p><a class="button secondary" href="/dashboard" data-link>返回首页</a></div></div>`;
}

function resultQuestion(item) {
  if (item.type === 'single' || item.type === 'multiple') {
    const single = item.type === 'single';
    const total = single ? item.respondentCount : item.answeredCount;
    const summary = single ? `${item.respondentCount} 人回答 · ${item.answeredCount} 次答卷` : `${item.answeredCount} 次答卷`;
    return `<article class="card result-card" data-result-question="${esc(item.id)}"><h3>${esc(item.title)}</h3><div class="result-meta">${questionType[item.type]} · ${summary}</div>${item.options.map((option) => { const count = single ? option.respondentCount : option.count; return `<div class="bar-row"><span>${esc(option.label)}</span><div class="bar"><span style="width:${total ? Math.round(count / total * 100) : 0}%"></span></div><strong>${count}${single ? ' 人' : ' 次'}</strong></div>`; }).join('')}</article>`;
  }
  return `<article class="card result-card" data-result-question="${esc(item.id)}"><h3>${esc(item.title)}</h3><div class="result-meta">${questionType[item.type]} · ${item.answeredCount} 次回答</div>${item.type === 'number' ? `<p class="big-average">${item.average === null ? '—' : Number(item.average.toFixed(2))} <span class="muted">平均值</span></p>` : ''}${item.values.length ? item.values.map((entry) => `<div class="result-value"><span>${esc(entry.value)}</span><span class="muted">${entry.respondentName ? esc(entry.respondentName) : '匿名'}</span></div>`).join('') : '<p class="muted">暂无回答</p>'}</article>`;
}

async function results(id, renderId) {
  const data = await api(`/api/surveys/${id}/stats`);
  if (renderId !== state.renderId) return;
  const survey = data.survey;
  app.innerHTML = `<a class="back-link" href="/surveys/${id}/edit" data-link>← 返回问卷</a><div class="page-head"><div><p class="eyebrow">Insights / 统计结果</p><h1 class="page-title">${esc(survey.title)}</h1><p class="page-subtitle">结果根据已提交的数据自动更新。</p></div><div class="page-actions">${survey.slug ? `<a class="button secondary" href="/survey/${survey.slug}" data-link>打开填写链接 ↗</a>` : ''}</div></div><div class="grid grid-3"><div class="card card-pad"><span class="stat-label">总提交数</span><p class="stat-number">${data.totalResponses}</p></div><div class="card card-pad"><span class="stat-label">题目数</span><p class="stat-number">${survey.questions.length}</p></div><div class="card card-pad"><span class="stat-label">当前状态</span><p class="stat-number" style="font-size:23px;padding-top:6px">${statusText[survey.status]}</p></div></div><div class="section-header"><h2 class="section-title">逐题统计</h2>${data.questions.length ? `<select id="question-filter" aria-label="筛选题目" style="max-width:220px"><option value="all">查看全部题目</option>${data.questions.map((q, i) => `<option value="${esc(q.id)}">第 ${i + 1} 题 · ${esc(q.title)}</option>`).join('')}</select>` : ''}</div>${data.questions.length ? `<div class="result-grid">${data.questions.map(resultQuestion).join('')}</div>` : `<div class="card empty"><p>尚未添加题目</p></div>`}<div class="section-header"><h2 class="section-title">最近提交</h2></div><div class="card card-pad">${data.submissions.length ? data.submissions.slice(0, 30).map((item) => `<div class="result-value"><span>${item.isAnonymous ? '匿名填写者' : esc(item.respondentName || '用户')} <span class="muted">${item.isAnonymous ? '· 身份已隐藏' : ''}</span></span><span class="muted">${dateText(item.submittedAt)}</span></div>`).join('') : `<p class="muted">还没有提交记录</p>`}</div>`;
}

async function render() {
  const renderId = ++state.renderId;
  topnav();
  const path = location.pathname;
  if (!state.user) { authView(); return; }
  try {
    if (path === '/' || path === '/dashboard') return await dashboard(renderId);
    if (path === '/surveys/new') return newSurvey();
    let match = path.match(/^\/surveys\/([a-f0-9]{24})\/edit$/);
    if (match) return await editor(match[1], renderId);
    match = path.match(/^\/surveys\/([a-f0-9]{24})\/results$/);
    if (match) return await results(match[1], renderId);
    match = path.match(/^\/survey\/([A-Za-z0-9_-]+)$/);
    if (match) return await fill(match[1], renderId);
    navigate('/dashboard');
  } catch (error) { if (renderId === state.renderId) pageError(error); }
}

document.addEventListener('click', async (event) => {
  const link = event.target.closest('[data-link]');
  if (link) { event.preventDefault(); navigate(new URL(link.href).pathname); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'auth-login' || action === 'auth-register') { state.authMode = action === 'auth-register' ? 'register' : 'login'; authView(); return; }
  if (action === 'logout') {
    await api('/api/logout', { method: 'POST' }); state.user = null; navigate('/'); return;
  }
  try {
    button.disabled = true;
    if (action.startsWith('fill-')) {
      if (action === 'fill-back') { state.fill.current--; fillPage(); }
      else await fillNext();
    } else if (state.editor) await editorAction(action, button);
  } catch (error) { toast(error.message, true); }
  finally { if (button.isConnected) button.disabled = false; }
});

document.addEventListener('input', (event) => handleEditorInput(event.target));
document.addEventListener('change', (event) => {
  if (event.target.id === 'anonymous-toggle' && state.fill) state.fill.isAnonymous = event.target.checked;
  if (event.target.id === 'question-filter') document.querySelectorAll('[data-result-question]').forEach((card) => { card.hidden = event.target.value !== 'all' && card.dataset.resultQuestion !== event.target.value; });
});
window.addEventListener('popstate', () => { state.editor = null; state.fill = null; render(); });

api('/api/me').then(({ user }) => { state.user = user; render(); }).catch(() => { state.user = null; render(); });
