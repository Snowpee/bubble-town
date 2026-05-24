import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectRecallRelativeTimeReferences,
  isPastRecallInput,
  isSuppressionDirectInquiry,
  removeRecallQueryFillerTerms,
} from './recall-language.js';

test('recall language policy 归一相对时间引用', () => {
  assert.deepEqual(detectRecallRelativeTimeReferences('昨天晚上我们做了哪些工作？'), [
    { reference: 'last_night', label: '昨晚' },
  ]);
  assert.deepEqual(detectRecallRelativeTimeReferences('今天晚上聊什么？'), [
    { reference: 'tonight', label: '今晚' },
  ]);
});

test('recall language policy 剥离召回查询 filler', () => {
  assert.equal(removeRecallQueryFillerTerms('昨天晚上我们聊了什么？').trim(), '晚上');
  assert.equal(removeRecallQueryFillerTerms('还记得上次约定吗？').trim(), '约定');
});

test('recall language policy 判断召回和 suppression 直接询问意图', () => {
  assert.equal(isPastRecallInput('还记得上次我们约定了什么吗？'), true);
  assert.equal(isPastRecallInput('我们等下出去走走吧'), false);
  assert.equal(isSuppressionDirectInquiry('为什么不要提这件事？'), true);
  assert.equal(isSuppressionDirectInquiry('换个话题'), false);
});

