export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const fail = (message) => { throw new InputError(message); };
const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max + 1) : '';
const finiteOrNull = (value, label) => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) fail(`${label}必须是数字`);
  return number;
};
const integer = (value, label, min, max) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) fail(`${label}必须在 ${min}–${max} 之间`);
  return number;
};

export function normalizeSurvey(input) {
  const title = text(input.title, 120);
  const description = text(input.description, 2000);
  if (!title || title.length > 120) fail('问卷标题应为 1–120 个字符');
  if (description.length > 2000) fail('问卷说明不能超过 2000 个字符');
  let deadline = null;
  if (input.deadline) {
    const date = new Date(input.deadline);
    if (Number.isNaN(date.getTime())) fail('截止时间格式不正确');
    deadline = date;
  }
  return {
    title,
    description,
    allowAnonymous: input.allowAnonymous === true,
    allowMultipleResponses: input.allowMultipleResponses === true,
    deadline,
  };
}

export function normalizeQuestions(input) {
  if (!Array.isArray(input) || input.length > 100) fail('题目数量不能超过 100');
  const ids = new Set();
  const questions = input.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`第 ${index + 1} 题格式无效`);
    const id = String(raw.id || '');
    if (!/^[a-zA-Z0-9_-]{2,80}$/.test(id) || ids.has(id)) fail(`第 ${index + 1} 题的 ID 无效或重复`);
    ids.add(id);
    const title = text(raw.title, 300);
    if (!title || title.length > 300) fail(`第 ${index + 1} 题需要标题`);
    const type = raw.type;
    if (!['single', 'multiple', 'text', 'number'].includes(type)) fail(`第 ${index + 1} 题类型无效`);
    const question = { id, title, type, required: raw.required === true, options: [], validation: {}, jumps: [] };

    if (type === 'single' || type === 'multiple') {
      if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 20) fail(`第 ${index + 1} 题需要 2–20 个选项`);
      const optionIds = new Set();
      question.options = raw.options.map((option) => {
        const optionId = String(option.id || '');
        const label = text(option.label, 120);
        if (!/^[a-zA-Z0-9_-]{3,80}$/.test(optionId) || optionIds.has(optionId) || !label || label.length > 120) fail(`第 ${index + 1} 题的选项无效`);
        optionIds.add(optionId);
        return { id: optionId, label };
      });
      if (type === 'multiple') {
        const min = integer(raw.validation?.minSelections ?? 0, '最少选择数', 0, question.options.length);
        const max = integer(raw.validation?.maxSelections ?? question.options.length, '最多选择数', 0, question.options.length);
        if (max < min) fail(`第 ${index + 1} 题的最多选择数不能小于最少选择数`);
        if (question.required && max === 0) fail(`第 ${index + 1} 题为必答题，最多选择数不能为 0`);
        question.validation = { minSelections: min, maxSelections: max };
      }
    } else if (type === 'text') {
      const min = integer(raw.validation?.minLength ?? 0, '最少字数', 0, 5000);
      const max = integer(raw.validation?.maxLength ?? 5000, '最多字数', 0, 5000);
      if (max < min) fail(`第 ${index + 1} 题的最多字数不能小于最少字数`);
      question.validation = { minLength: min, maxLength: max };
    } else {
      const min = finiteOrNull(raw.validation?.min, '最小值');
      const max = finiteOrNull(raw.validation?.max, '最大值');
      if (min !== null && max !== null && max < min) fail(`第 ${index + 1} 题的最大值不能小于最小值`);
      question.validation = { min, max, integerOnly: raw.validation?.integerOnly === true };
    }

    if (!Array.isArray(raw.jumps) || raw.jumps.length > 20) fail(`第 ${index + 1} 题的跳转规则无效`);
    question.jumps = raw.jumps.map((rule) => {
      const operator = String(rule.operator || '');
      const target = String(rule.target || '');
      let value;
      if (type === 'single' || type === 'multiple') {
        if (operator !== (type === 'single' ? 'equals' : 'includes')) fail(`第 ${index + 1} 题的跳转条件无效`);
        value = String(rule.value || '');
        if (!question.options.some((option) => option.id === value)) fail(`第 ${index + 1} 题的跳转选项不存在`);
      } else if (type === 'number') {
        if (!['eq', 'gt', 'gte', 'lt', 'lte'].includes(operator)) fail(`第 ${index + 1} 题的数字比较条件无效`);
        value = finiteOrNull(rule.value, '跳转比较值');
        if (value === null) fail(`第 ${index + 1} 题缺少跳转比较值`);
      } else fail('文本题不支持条件跳转');
      return { operator, value, target };
    });
    return question;
  });

  questions.forEach((question, index) => {
    question.jumps.forEach((rule) => {
      if (rule.target === 'END') return;
      const targetIndex = questions.findIndex((item) => item.id === rule.target);
      if (targetIndex <= index) fail(`「${question.title}」只能跳转到后面的题目`);
    });
  });
  return questions;
}

function hasAnswer(answer) {
  return answer !== undefined && answer !== null && answer !== '' && (!Array.isArray(answer) || answer.length > 0);
}

export function validateAnswer(question, answer) {
  if (!hasAnswer(answer)) {
    if (question.required || (question.type === 'multiple' && question.validation.minSelections > 0) || (question.type === 'text' && question.validation.minLength > 0)) fail(`「${question.title}」必须填写`);
    return null;
  }
  if (question.type === 'single') {
    if (typeof answer !== 'string' || !question.options.some((option) => option.id === answer)) fail(`「${question.title}」的选项无效`);
    return answer;
  }
  if (question.type === 'multiple') {
    if (!Array.isArray(answer) || new Set(answer).size !== answer.length || answer.some((value) => !question.options.some((option) => option.id === value))) fail(`「${question.title}」的选项无效`);
    const { minSelections, maxSelections } = question.validation;
    if (answer.length < Math.max(minSelections, question.required ? 1 : 0) || answer.length > maxSelections) fail(`「${question.title}」需选择 ${Math.max(minSelections, question.required ? 1 : 0)}–${maxSelections} 项`);
    return answer;
  }
  if (question.type === 'text') {
    if (typeof answer !== 'string') fail(`「${question.title}」需要文本答案`);
    const value = answer.trim();
    const length = Array.from(value).length;
    if (length < question.validation.minLength || length > question.validation.maxLength) fail(`「${question.title}」需输入 ${question.validation.minLength}–${question.validation.maxLength} 字`);
    return value;
  }
  if (typeof answer !== 'number' || !Number.isFinite(answer)) fail(`「${question.title}」需要数字答案`);
  const { min, max, integerOnly } = question.validation;
  if ((min !== null && answer < min) || (max !== null && answer > max) || (integerOnly && !Number.isInteger(answer))) fail(`「${question.title}」的数字不符合限制`);
  return answer;
}

function ruleMatches(rule, answer) {
  if (answer === null) return false;
  switch (rule.operator) {
    case 'equals': case 'eq': return answer === rule.value;
    case 'includes': return Array.isArray(answer) && answer.includes(rule.value);
    case 'gt': return answer > rule.value;
    case 'gte': return answer >= rule.value;
    case 'lt': return answer < rule.value;
    case 'lte': return answer <= rule.value;
    default: return false;
  }
}

export function nextQuestionId(questions, index, answer) {
  const match = questions[index].jumps.find((rule) => ruleMatches(rule, answer));
  return match ? match.target : (questions[index + 1]?.id || 'END');
}

export function validateSubmission(questions, rawAnswers) {
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) fail('答案格式无效');
  const answers = {};
  let index = 0;
  while (index < questions.length) {
    const question = questions[index];
    const answer = validateAnswer(question, rawAnswers[question.id]);
    if (answer !== null) answers[question.id] = answer;
    const target = nextQuestionId(questions, index, answer);
    if (target === 'END') break;
    const nextIndex = questions.findIndex((item) => item.id === target);
    if (nextIndex <= index) fail('问卷跳转规则无效');
    index = nextIndex;
  }
  if (Object.keys(rawAnswers).some((id) => !Object.hasOwn(answers, id))) fail('提交包含未作答或已跳过的题目');
  return answers;
}
