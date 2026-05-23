import type { SuppressedMemory } from '@bubble-town/shared';

const STOP_TOKENS = new Set([
  '不要',
  '别再',
  '以后',
  '主动',
  '提及',
  '提起',
  '不想',
  '再提',
  '上次',
  '事情',
  '这个',
  '那个',
]);

const STRONG_TOPIC_TOKENS = new Set(['skill', '技能']);

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function tokenize(value: string): string[] {
  const normalized = normalize(value)
    .replace(/[，。！？、；：“”"'`~!@#$%^&*()[\]{}<>|\\/_+=,.?:;-]/g, ' ');
  const ascii = normalized.match(/[a-z0-9][a-z0-9-]{1,}/g) ?? [];
  const cjk = Array.from(new Set(normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? []));
  const cjkPairs = cjk.flatMap((segment) => {
    const pairs: string[] = [];
    for (let index = 0; index < segment.length - 1; index += 1) {
      pairs.push(segment.slice(index, index + 2));
    }
    return pairs;
  });
  return Array.from(new Set([...ascii, ...cjk, ...cjkPairs])).filter((token) => token.length >= 2);
}

function expandSynonyms(tokens: string[]): string[] {
  const expanded = new Set(tokens);
  if (tokens.includes('skill') || tokens.includes('skills')) {
    expanded.add('技能');
  }
  if (tokens.includes('技能')) {
    expanded.add('skill');
  }
  return Array.from(expanded);
}

export function suppressionTokens(suppression: SuppressedMemory): string[] {
  return expandSynonyms(tokenize(suppression.pattern))
    .filter((token) => !STOP_TOKENS.has(token));
}

export function matchesSuppressionText(value: string, suppressions: SuppressedMemory[]): boolean {
  const content = normalize(value);
  if (!content) {
    return false;
  }

  return suppressions.some((suppression) => {
    const pattern = normalize(suppression.pattern);
    if (pattern && (content.includes(pattern) || pattern.includes(content))) {
      return true;
    }

    const tokens = suppressionTokens(suppression);
    if (tokens.length === 0) {
      return false;
    }

    const matched = tokens.filter((token) => content.includes(token));
    if (matched.some((token) => STRONG_TOPIC_TOKENS.has(token))) {
      return true;
    }
    if (tokens.length <= 2) {
      return matched.length === tokens.length;
    }
    return matched.length >= 2;
  });
}
