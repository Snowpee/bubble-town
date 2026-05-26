import type { ActivityLog, Storyline, WorldStateDebugTrace, WorldStateUpdateCandidate } from '@bubble-town/shared';
import { getAuxiliaryLLMInvoker } from '../../services/auxiliary-llm-invoker.js';
import { decideWorldStateReject } from './world-state-policy.js';
import { buildSceneProjection, createWorldStateUpdateCandidate, getStorylineSceneId } from './world-state.js';

export interface WorldStateExtractorExecutionOptions {
  apiBaseUrl?: string;
  managedGatewayProfileId?: string;
}

export interface WorldStateExtractorInput {
  storyline: Storyline;
  userInput: string;
  assistantOutput: string;
  sourceMessageIds?: string[];
  sourceActivityIds?: string[];
  recentActivityLogs?: Pick<ActivityLog, 'id' | 'happenedAt' | 'summary'>[];
  executionOptions?: WorldStateExtractorExecutionOptions;
  debugTrace?: WorldStateDebugTrace;
}

export interface WorldStateCandidateExtractor {
  extract(input: WorldStateExtractorInput): Promise<WorldStateUpdateCandidate[]>;
}

interface StructuredWorldStateCandidate {
  objectLabel: string;
  stateKind: 'status' | 'location';
  state: string;
  locationText?: string;
  actionType: 'place' | 'move' | 'open' | 'close' | 'break' | 'repair' | 'unknown';
  sourceSpan: string;
  isCurrentStableState: boolean;
  temporalScope?: 'instantaneous' | 'session' | 'stable' | 'recurring' | 'historical' | 'unknown';
  stability?: 'transient' | 'stable' | 'uncertain' | 'unknown';
  stabilityReason?: string;
  confidence: number;
}

interface StructuredWorldStateCandidateResponse {
  candidates: StructuredWorldStateCandidate[];
}

export const WORLD_STATE_CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['objectLabel', 'stateKind', 'state', 'actionType', 'sourceSpan', 'isCurrentStableState', 'temporalScope', 'stability', 'confidence'],
        properties: {
          objectLabel: { type: 'string' },
          stateKind: { type: 'string', enum: ['status', 'location'] },
          state: { type: 'string' },
          locationText: { type: 'string' },
          actionType: { type: 'string', enum: ['place', 'move', 'open', 'close', 'break', 'repair', 'unknown'] },
          sourceSpan: { type: 'string' },
          isCurrentStableState: { type: 'boolean' },
          temporalScope: { type: 'string', enum: ['instantaneous', 'session', 'stable', 'recurring', 'historical', 'unknown'] },
          stability: { type: 'string', enum: ['transient', 'stable', 'uncertain', 'unknown'] },
          stabilityReason: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
  },
} as const;

function buildWorldStateExtractorInstructions(input: WorldStateExtractorInput): string {
  return [
    '你是 Bubble Town 的 world state structured extractor。',
    '你的任务是从当前这一轮对话里提取“当前仍然成立的稳定世界物体状态”。',
    '只输出 JSON，不要输出解释。',
    '如果没有应写入的稳定世界状态，返回 {"candidates": []}。',
    '不要把假设句、梦境、比喻、回忆、纯情绪或一次性环境描写写成 candidate。',
    '允许提取两类稳定状态：1) 物体状态变化，例如损坏、修好、打开、关上；2) 物体当前位置，例如放在、挂在、摆在、塞进、藏在某处。',
    'sceneId 已由应用层给定，不需要你生成。',
    '必须输出强结构，而不是自由摘要。',
    'stateKind 只能是 status 或 location。',
    'status 类 state 应为简短稳定标签，例如 broken、intact、open、closed、lost、found、discarded。',
    'location 类 state 固定为 located，并把具体位置写入 locationText，例如“玄关柜第二层抽屉里”。',
    '如果当前 turn 明确表示某物体已经恢复、找回、取回、重新归位或重新放回某处，需要输出新的 candidate 来覆盖 sceneProjection 中同物体的旧状态。',
    '如果当前 turn 只有省略主语或代词化的恢复表达，必须优先用 recentActivityLogs 和 sceneProjection 补全对象；补不出来就不要输出泛化对象。',
    '如果对象能被补全但没有具体位置，可以输出 status candidate，例如 found 或 intact。',
    '如果当前 turn 给出了新的具体位置，优先输出 location candidate；新的 location candidate 会覆盖同物体旧的 status 或 location。',
    '必须用 temporalScope 与 stability 表达状态是否稳定：短时携带、手持、刚发现、刚移动但未归位等瞬时现场状态应标记 temporalScope=instantaneous 且 stability=transient，不能作为稳定 scene state 写入。',
    'actionType 表示本轮动作类型，例如 place、move、break、repair、open、close。',
    'sourceSpan 只摘录触发该候选的核心中文片段。',
    'isCurrentStableState 必须表示这是否是当前已经发生并仍然成立的事实；不确定时返回 false。',
    'objectLabel 只保留物体本身名称，例如“家门钥匙”“旧台灯”。',
    'objectLabel 禁止使用 object、item、thing、东西、物品、某物这类泛化占位词。',
    `当前 sceneId: ${getStorylineSceneId(input.storyline)}`,
  ].join('\n');
}

function buildExistingWorldStateContext(input: WorldStateExtractorInput): string {
  const sceneProjection = buildSceneProjection(input.storyline.id, getStorylineSceneId(input.storyline));
  if (!sceneProjection?.items.length) {
    return 'sceneProjection: none';
  }

  return [
    `sceneProjectionSummary: ${sceneProjection.summary}`,
    'sceneProjectionItems:',
    ...sceneProjection.items.map((item) => (
      `- object=${item.objectLabel}; stateKind=${item.stateKind}; state=${item.state}; locationText=${item.locationText ?? ''}; content=${item.content}`
    )),
  ].join('\n');
}

function buildWorldStateExtractorPrompt(input: WorldStateExtractorInput): string {
  return [
    '<BubbleTownWorldStateTurn>',
    `storylineTitle: ${input.storyline.title}`,
    `sceneId: ${getStorylineSceneId(input.storyline)}`,
    buildExistingWorldStateContext(input),
    input.recentActivityLogs?.length
      ? [
        'recentActivityLogs:',
        ...input.recentActivityLogs.map((entry) => `- [${entry.happenedAt}] ${entry.summary}`),
      ].join('\n')
      : 'recentActivityLogs: none',
    `userInput: ${input.userInput}`,
    `assistantOutput: ${input.assistantOutput}`,
    '</BubbleTownWorldStateTurn>',
  ].join('\n');
}

function dedupeCandidates(candidates: WorldStateUpdateCandidate[]): WorldStateUpdateCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.sceneId}|${candidate.objectLabel}|${candidate.stateKind}|${candidate.state}|${candidate.locationText ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function sourceHappenedAtRange(input: WorldStateExtractorInput): {
  sourceHappenedAtStart?: string;
  sourceHappenedAtEnd?: string;
} {
  const values = input.recentActivityLogs
    ?.filter((entry) => input.sourceActivityIds?.includes(entry.id))
    .map((entry) => entry.happenedAt)
    .sort() ?? [];
  return {
    sourceHappenedAtStart: values[0],
    sourceHappenedAtEnd: values[values.length - 1],
  };
}

export function createStructuredWorldStateExtractor(): WorldStateCandidateExtractor {
  return {
    async extract(input) {
      const decision = decideWorldStateReject(input.userInput);
      if (input.debugTrace) {
        input.debugTrace.rejectDecision = decision;
      }
      if (decision.rejected) {
        if (input.debugTrace) {
          input.debugTrace.skippedReason = decision.reason ?? 'world state policy rejected current turn';
        }
        return [];
      }

      const prompt = buildWorldStateExtractorPrompt(input);
      const instructions = buildWorldStateExtractorInstructions(input);
      if (input.debugTrace) {
        input.debugTrace.llmRequest = {
          instructions,
          prompt,
        };
      }

      const response = await getAuxiliaryLLMInvoker().invoke<StructuredWorldStateCandidateResponse>({
        profileId: input.storyline.hermesProfileId,
        taskType: 'world-state',
        input: prompt,
        runtimeInstructions: instructions,
        schemaName: 'bubble_town_world_state_candidates',
        schema: WORLD_STATE_CANDIDATE_SCHEMA,
      }, input.executionOptions);

      const happenedAtRange = sourceHappenedAtRange(input);
      const candidates = dedupeCandidates(
        (response.candidates ?? [])
          .flatMap((candidate) => {
            const worldStateCandidate = createWorldStateUpdateCandidate({
              sceneId: getStorylineSceneId(input.storyline),
              objectLabel: candidate.objectLabel,
              stateKind: candidate.stateKind,
              state: candidate.state,
              locationText: candidate.locationText,
              actionType: candidate.actionType,
              sourceSpan: candidate.sourceSpan,
              isCurrentStableState: candidate.isCurrentStableState,
              temporalScope: candidate.temporalScope,
              stability: candidate.stability,
              stabilityReason: candidate.stabilityReason,
              reason: '由 LLM structured output 生成的 world state candidate，经应用层校验后可写入当前状态。',
              confidence: candidate.confidence,
              sourceMessageIds: input.sourceMessageIds,
              sourceActivityIds: input.sourceActivityIds,
              ...happenedAtRange,
            });
            return worldStateCandidate ? [worldStateCandidate] : [];
          }),
      );
      if (input.debugTrace) {
        input.debugTrace.llmResponse = {
          candidates,
        };
      }
      return candidates;
    },
  };
}
