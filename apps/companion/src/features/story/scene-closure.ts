import type {
  OffscreenCanonLevel,
  OffscreenResolution,
  OffscreenResolutionMode,
  OpenLoop,
  PendingSemanticFrame,
  ResumeMode,
  SceneClosureContext,
  SceneState,
} from '@bubble-town/shared';

function hasSensitivePendingFrame(pendingSemanticFrames: PendingSemanticFrame[]): boolean {
  return pendingSemanticFrames.some((frame) => (
    frame.kind === 'commitment_confirm'
    || frame.kind === 'relationship_confirm'
  ));
}

function hasHighSensitivityOpenLoop(openLoops: OpenLoop[]): boolean {
  return openLoops.some((loop) => (
    loop.status !== 'closed'
    && loop.sensitivity === 'high'
    && (loop.kind === 'commitment' || loop.kind === 'story' || loop.kind === 'emotion')
  ));
}

function isLongGap(resumeMode: ResumeMode): boolean {
  return resumeMode === 'reopen_thread' || resumeMode === 'fresh_start_with_memory';
}

function isSoftClosePolicy(sceneState: SceneState): boolean {
  return sceneState.closurePolicy === 'soft_close' || sceneState.closurePolicy === 'auto_complete';
}

function highRiskMode(sceneState: SceneState): OffscreenResolutionMode {
  if (sceneState.closurePolicy === 'pause_exact') {
    return 'preserve_cliffhanger';
  }
  return 'ask_user';
}

function softCloseSummary(sceneState: SceneState): string {
  return `上次 ${sceneState.kind} 场景已镜头外软收束：那一幕可以理解为自然结束，没有确认新的承诺、冲突或关系变化。`;
}

export function resolveSceneClosureContext(input: {
  resumeMode: ResumeMode;
  sceneState?: SceneState;
  offscreenResolution?: OffscreenResolution;
  openLoops?: OpenLoop[];
  pendingSemanticFrames?: PendingSemanticFrame[];
}): SceneClosureContext {
  const openLoops = input.openLoops ?? [];
  const pendingSemanticFrames = input.pendingSemanticFrames ?? [];
  const sceneState = input.sceneState;

  if (!sceneState) {
    return {
      mode: 'none',
      shouldCreateResolution: false,
      instruction: '当前没有 sceneState；不要根据 sceneProjection 推断旧场景是否仍在进行，只按 temporalResume、activityLogs 和 recentMessages 安全恢复。',
    };
  }

  if (input.offscreenResolution) {
    return {
      mode: input.offscreenResolution.mode,
      shouldCreateResolution: false,
      summary: input.offscreenResolution.summary,
      canonLevel: input.offscreenResolution.canonLevel,
      confidence: input.offscreenResolution.confidence,
      instruction: `当前场景已有 offscreenResolution（${input.offscreenResolution.mode}/${input.offscreenResolution.canonLevel}）；它是镜头外收束参考，除非 canonLevel=confirmed，否则可被用户改写。`,
    };
  }

  if (hasSensitivePendingFrame(pendingSemanticFrames) || hasHighSensitivityOpenLoop(openLoops)) {
    return {
      mode: 'ask_user',
      shouldCreateResolution: false,
      instruction: '当前存在高敏感待确认语义或 openLoop；不要自动收束场景，应询问用户继续、放下还是先确认关键事项。',
    };
  }

  if (
    sceneState.kind === 'conflict'
    || sceneState.kind === 'decision'
    || sceneState.kind === 'story'
    || sceneState.kind === 'emotional'
  ) {
    const mode = highRiskMode(sceneState);
    return {
      mode,
      shouldCreateResolution: false,
      instruction: mode === 'preserve_cliffhanger'
        ? '当前场景属于关键节点；必须精确暂停或保留悬念，不要自动补完剧情。'
        : '当前场景有较高叙事或情绪风险；应询问用户继续还是先放下，不要自动完成。',
    };
  }

  if (
    sceneState.kind === 'casual_life'
    && isLongGap(input.resumeMode)
    && isSoftClosePolicy(sceneState)
  ) {
    const canonLevel: OffscreenCanonLevel = sceneState.closurePolicy === 'auto_complete' ? 'soft' : 'non_canon';
    return {
      mode: 'soft_close',
      shouldCreateResolution: true,
      summary: softCloseSummary(sceneState),
      canonLevel,
      confidence: 0.76,
      instruction: '当前是低风险生活场景且已经长间隔；可以把上一幕理解为镜头外自然淡出。该收束不是 confirmed canon，可被用户改写，且不得写成关系升级、承诺或冲突解决。',
    };
  }

  return {
    mode: 'none',
    shouldCreateResolution: false,
    instruction: '当前场景不需要自动收束；按 temporalResume 和当前输入自然承接。',
  };
}
