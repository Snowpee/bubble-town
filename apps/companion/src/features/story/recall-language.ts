import type { RelativeTimeReference } from '@bubble-town/shared';

export interface RelativeTimePatternDefinition {
  reference: RelativeTimeReference;
  label: string;
  patterns: RegExp[];
  suppressReferences?: RelativeTimeReference[];
}

export const RELATIVE_TIME_PATTERN_DEFINITIONS: RelativeTimePatternDefinition[] = [
  { reference: 'day_before_yesterday', label: '前天', patterns: [/前天/] },
  { reference: 'last_night', label: '昨晚', patterns: [/昨晚|昨天晚上|昨夜/], suppressReferences: ['yesterday'] },
  { reference: 'yesterday', label: '昨天', patterns: [/昨天|昨日/] },
  { reference: 'tonight', label: '今晚', patterns: [/今晚|今天晚上/], suppressReferences: ['today'] },
  { reference: 'today', label: '今天', patterns: [/今天|今日/] },
  { reference: 'previous', label: '上次', patterns: [/上次|之前|前一次|刚才聊|上回/] },
];

const RECALL_QUERY_FILLER_TERMS = [
  '昨天',
  '昨日',
  '前天',
  '昨晚',
  '昨天晚上',
  '昨夜',
  '今晚',
  '今天晚上',
  '今天',
  '今日',
  '上次',
  '之前',
  '前一次',
  '我们',
  '聊了',
  '什么',
  '还记得',
  '了',
  '吗',
  '啊',
  '呢',
  '呀',
];

const PAST_RECALL_TERMS = [
  '昨天',
  '前天',
  '昨晚',
  '上次',
  '之前',
  '还记得',
  '记得',
  '聊过',
  '说过',
  '约定',
];

const SUPPRESSION_DIRECT_INQUIRY_TERMS = [
  '还记得',
  '为什么',
  '说说',
  '提',
  '聊',
];

function includesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsAnyTerm(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

export function detectRecallRelativeTimeReferences(input: string): Array<{ reference: RelativeTimeReference; label: string }> {
  const detected = RELATIVE_TIME_PATTERN_DEFINITIONS
    .filter((entry) => includesAny(input, entry.patterns))
    .map((entry) => ({ reference: entry.reference, label: entry.label }));
  const suppressed = new Set(
    RELATIVE_TIME_PATTERN_DEFINITIONS
      .filter((entry) => detected.some((detectedEntry) => detectedEntry.reference === entry.reference))
      .flatMap((entry) => entry.suppressReferences ?? []),
  );
  return detected.filter((entry) => !suppressed.has(entry.reference));
}

export function removeRecallQueryFillerTerms(input: string): string {
  return RECALL_QUERY_FILLER_TERMS.reduce(
    (current, term) => current.replace(new RegExp(escapeRegExp(term), 'g'), ' '),
    input.replace(/[？?]/g, ' '),
  );
}

export function isPastRecallInput(input: string): boolean {
  return containsAnyTerm(input, PAST_RECALL_TERMS);
}

export function isSuppressionDirectInquiry(input: string): boolean {
  return containsAnyTerm(input, SUPPRESSION_DIRECT_INQUIRY_TERMS);
}

