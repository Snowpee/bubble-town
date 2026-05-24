export interface WorldStateRejectDecision {
  rejected: boolean;
  reason?: string;
}

const HYPOTHETICAL_PATTERN = /如果|要是|假如|假设|假若|万一|会怎样|会怎么样/;
const NON_LITERAL_PATTERN = /梦见|做梦|梦里|回忆里|想象中|比喻|打个比方|像是|仿佛/;
const TRANSIENT_ENVIRONMENT_PATTERN = /灰尘|光斑|水汽|雾气|晚霞|风声|香味|气氛|氛围/;

export function decideWorldStateReject(input: string): WorldStateRejectDecision {
  const normalized = input.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return {
      rejected: true,
      reason: '输入为空，不进入 world state 抽取。',
    };
  }

  if (HYPOTHETICAL_PATTERN.test(normalized)) {
    return {
      rejected: true,
      reason: '输入属于假设句，不应写入当前世界状态。',
    };
  }

  if (NON_LITERAL_PATTERN.test(normalized)) {
    return {
      rejected: true,
      reason: '输入属于梦境、比喻或回忆语境，不应写入当前世界状态。',
    };
  }

  if (TRANSIENT_ENVIRONMENT_PATTERN.test(normalized) && !/放在|摆在|挂在|塞进|藏在|砸碎|打碎|修好|打开|关上/.test(normalized)) {
    return {
      rejected: true,
      reason: '输入更像一次性环境描写，不默认创建 world state。',
    };
  }

  return {
    rejected: false,
  };
}
