import type {
  ActivityLog,
  Storyline,
  WorldStateDebugTrace,
  WorldStateSideChannelTrace,
  WorldStateUpdateCandidate,
} from '@bubble-town/shared';
import { getAuxiliaryLLMInvoker } from '../../services/auxiliary-llm-invoker.js';
import { decideWorldStateReject } from './world-state-policy.js';
import { buildSceneProjection, createWorldStateUpdateCandidate, getStorylineSceneId } from './world-state.js';
import type { WorldStateExtractorExecutionOptions } from './world-state-extractor.js';

export interface WorldStateSideChannelInput {
  storyline: Storyline;
  userInput: string;
  assistantOutput: string;
  sourceMessageIds?: string[];
  sourceActivityIds?: string[];
  recentActivityLogs?: Pick<ActivityLog, 'id' | 'happenedAt' | 'summary'>[];
  executionOptions?: WorldStateExtractorExecutionOptions;
  debugTrace?: WorldStateDebugTrace;
}

export interface WorldStateSideChannelGate {
  decide(input: WorldStateSideChannelInput): Promise<WorldStateSideChannelTrace>;
}

interface StructuredWorldStateSideChannelCandidate {
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

interface StructuredWorldStateSideChannelResponse {
  decision: 'skip' | 'direct_apply' | 'uncertain';
  reason?: string;
  confidence: number;
  candidates: StructuredWorldStateSideChannelCandidate[];
}

const WORLD_STATE_SIDE_CHANNEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'confidence', 'candidates'],
  properties: {
    decision: {
      type: 'string',
      enum: ['skip', 'direct_apply', 'uncertain'],
    },
    reason: { type: 'string' },
    confidence: { type: 'number' },
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

function buildExistingWorldStateContext(input: WorldStateSideChannelInput): string {
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

function buildWorldStateSideChannelInstructions(input: WorldStateSideChannelInput): string {
  return [
    '你是 Bubble Town 的 world state side-channel gate。',
    '你的任务不是写自然语言回复，而是判断当前这一轮是否值得进入 world state 应用层。',
    '只输出 JSON，不要输出解释。',
    'decision 只能是 skip、direct_apply 或 uncertain。',
    'skip 表示当前 turn 明确不需要写入 world state。',
    'direct_apply 表示当前 turn 已经足够明确，可以直接提供 1 到 3 个结构化 candidate 给应用层做 deterministic 校验与落盘。',
    'uncertain 表示当前 turn 可能存在稳定世界状态变化，但当前信号不足，应用层应触发独立 extractor 做后续深挖。',
    '不要把假设句、梦境、比喻、回忆、纯情绪或一次性环境描写写成 candidate。',
    '如果用户明确说明了物体当前位置或当前稳定状态，优先使用 direct_apply。',
    '如果当前 turn 只是在追问、确认、情绪回应、闲聊，且没有新的稳定事实，使用 skip。',
    '如果当前 turn 省略了主语或使用代词化恢复表达，必须优先用 recentActivityLogs 和 sceneProjection 补全对象；补不出来时使用 uncertain，不要输出泛化占位对象。',
    'candidate 的 stateKind 只能是 status 或 location。',
    'status 类 state 应为简短稳定标签，例如 broken、intact、open、closed、lost、found、discarded。',
    'location 类 state 固定为 located，并把具体位置写入 locationText。',
    '必须用 temporalScope 与 stability 表达状态是否稳定；短时携带、手持、刚发现、未归位的现场状态应标记 transient，不得作为稳定 scene state 写入。',
    '如果 decision 不是 direct_apply，则 candidates 返回空数组。',
    `当前 sceneId: ${getStorylineSceneId(input.storyline)}`,
  ].join('\n');
}

function buildWorldStateSideChannelPrompt(input: WorldStateSideChannelInput): string {
  return [
    '<BubbleTownWorldStateSideChannel>',
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
    '</BubbleTownWorldStateSideChannel>',
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

function sourceHappenedAtRange(input: WorldStateSideChannelInput): {
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

function mapStructuredCandidates(
  input: WorldStateSideChannelInput,
  candidates: StructuredWorldStateSideChannelCandidate[],
): WorldStateUpdateCandidate[] {
  const happenedAtRange = sourceHappenedAtRange(input);
  return dedupeCandidates(
    candidates.flatMap((candidate) => {
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
        reason: '由 world state side-channel gating 直接给出的候选，仍需经过应用层 deterministic 校验后才可写入。',
        confidence: candidate.confidence,
        sourceMessageIds: input.sourceMessageIds,
        sourceActivityIds: input.sourceActivityIds,
        ...happenedAtRange,
      });
      return worldStateCandidate ? [worldStateCandidate] : [];
    }),
  );
}

export function createStructuredWorldStateSideChannelGate(): WorldStateSideChannelGate {
  return {
    async decide(input) {
      const rejectDecision = decideWorldStateReject(input.userInput);
      if (input.debugTrace) {
        input.debugTrace.rejectDecision = rejectDecision;
      }
      if (rejectDecision.rejected) {
        const skipped: WorldStateSideChannelTrace = {
          decision: 'skip',
          reason: rejectDecision.reason ?? 'world state policy rejected current turn',
          confidence: 1,
          candidates: [],
        };
        if (input.debugTrace) {
          input.debugTrace.processingPath = 'skip';
          input.debugTrace.gatingResponse = skipped;
          input.debugTrace.skippedReason = skipped.reason;
        }
        return skipped;
      }

      const instructions = buildWorldStateSideChannelInstructions(input);
      const prompt = buildWorldStateSideChannelPrompt(input);
      if (input.debugTrace) {
        input.debugTrace.gatingRequest = {
          instructions,
          prompt,
        };
      }

      const response = await getAuxiliaryLLMInvoker().invoke<StructuredWorldStateSideChannelResponse>({
        profileId: input.storyline.hermesProfileId,
        taskType: 'world-state',
        input: prompt,
        runtimeInstructions: instructions,
        schemaName: 'bubble_town_world_state_side_channel',
        schema: WORLD_STATE_SIDE_CHANNEL_SCHEMA,
      }, input.executionOptions);

      const trace: WorldStateSideChannelTrace = {
        decision: response.decision,
        reason: response.reason,
        confidence: response.confidence,
        candidates: response.decision === 'direct_apply' ? mapStructuredCandidates(input, response.candidates ?? []) : [],
      };
      if (input.debugTrace) {
        input.debugTrace.gatingResponse = trace;
      }
      return trace;
    },
  };
}
