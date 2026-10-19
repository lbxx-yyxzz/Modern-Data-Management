import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuestions, normalizeSurvey, validateSubmission } from '../validation.js';

const questions = normalizeQuestions([
  { id: 'q1', title: '选择路径', type: 'single', required: true, options: [{ id: 'opt_a', label: '跳过第二题' }, { id: 'opt_b', label: '继续' }], validation: {}, jumps: [{ operator: 'equals', value: 'opt_a', target: 'q3' }] },
  { id: 'q2', title: '选择爱好', type: 'multiple', required: true, options: [{ id: 'opt_x', label: '阅读' }, { id: 'opt_y', label: '运动' }, { id: 'opt_z', label: '音乐' }], validation: { minSelections: 2, maxSelections: 2 }, jumps: [] },
  { id: 'q3', title: '年龄', type: 'number', required: true, options: [], validation: { min: 0, max: 120, integerOnly: true }, jumps: [] },
]);

test('跳转后只校验实际经过的题目', () => {
  assert.deepEqual(validateSubmission(questions, { q1: 'opt_a', q3: 21 }), { q1: 'opt_a', q3: 21 });
  assert.throws(() => validateSubmission(questions, { q1: 'opt_a', q2: ['opt_x', 'opt_y'], q3: 21 }), /已跳过/);
});

test('多选固定数量和数字范围均由后端校验', () => {
  assert.throws(() => validateSubmission(questions, { q3: 21 }), /必须填写/);
  assert.throws(() => validateSubmission(questions, { q1: 'opt_b', q2: ['opt_x'], q3: 21 }), /需选择/);
  assert.throws(() => validateSubmission(questions, { q1: 'opt_b', q2: ['opt_x', 'opt_y'], q3: 121 }), /不符合限制/);
  assert.throws(() => validateSubmission(questions, { q1: 'opt_b', q2: ['opt_x', 'opt_y'], q3: 21.5 }), /不符合限制/);
});

test('跳转不能回到当前或前面的题目', () => {
  assert.throws(() => normalizeQuestions([{ ...questions[0], jumps: [{ operator: 'equals', value: 'opt_a', target: 'q1' }] }]), /后面的题目/);
});

test('多选包含选项和数字比较都能决定跳转路径', () => {
  const branching = normalizeQuestions([
    { id: 'q1', title: '兴趣', type: 'multiple', required: true, options: [{ id: 'opt_a', label: '阅读' }, { id: 'opt_b', label: '运动' }], validation: { minSelections: 1, maxSelections: 2 }, jumps: [{ operator: 'includes', value: 'opt_b', target: 'q3' }] },
    { id: 'q2', title: '年龄', type: 'number', required: true, options: [], validation: { min: 0, max: 120, integerOnly: true }, jumps: [{ operator: 'gt', value: 50, target: 'q4' }] },
    { id: 'q3', title: '理由', type: 'text', required: true, options: [], validation: { minLength: 2, maxLength: 4 }, jumps: [] },
    { id: 'q4', title: '备注', type: 'text', required: false, options: [], validation: { minLength: 0, maxLength: 10 }, jumps: [] },
  ]);
  assert.deepEqual(validateSubmission(branching, { q1: ['opt_b'], q3: '喜欢', q4: '完成' }), { q1: ['opt_b'], q3: '喜欢', q4: '完成' });
  assert.deepEqual(validateSubmission(branching, { q1: ['opt_a'], q2: 51, q4: '完成' }), { q1: ['opt_a'], q2: 51, q4: '完成' });
  assert.throws(() => validateSubmission(branching, { q1: ['opt_b'], q3: '短', q4: '完成' }), /2–4/);
  assert.throws(() => validateSubmission(branching, { q1: ['opt_b'], q3: '输入过长的内容', q4: '完成' }), /2–4/);
});

test('问卷元信息校验标题和截止时间', () => {
  assert.throws(() => normalizeSurvey({ title: '' }), /标题/);
  assert.throws(() => normalizeSurvey({ title: '测试', deadline: 'bad-date' }), /截止时间/);
});
