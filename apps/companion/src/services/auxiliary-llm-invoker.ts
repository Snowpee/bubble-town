import { randomUUID } from 'node:crypto';
import type { AuxiliaryLlmUseCase } from '@bubble-town/shared';
import { requestStructuredData, type ChatExecutionOptions } from '../adapters/hermes/hermes-api.js';
import { recordAuxiliaryLlmInvocation, resolveAuxiliaryLlmRuntime } from '../store/auxiliary-llm-store.js';

export interface AuxiliaryLLMInvokerTask<TSchema extends Record<string, unknown> = Record<string, unknown>> {
  profileId?: string;
  taskType: AuxiliaryLlmUseCase;
  input: string;
  runtimeInstructions: string;
  schemaName: string;
  schema: TSchema;
}

export interface AuxiliaryLLMInvoker {
  invoke<TResult>(
    task: AuxiliaryLLMInvokerTask,
    executionOptions?: ChatExecutionOptions,
  ): Promise<TResult>;
}

class DefaultAuxiliaryLLMInvoker implements AuxiliaryLLMInvoker {
  async invoke<TResult>(
    task: AuxiliaryLLMInvokerTask,
    executionOptions: ChatExecutionOptions = {},
  ): Promise<TResult> {
    const runtime = resolveAuxiliaryLlmRuntime(task.profileId, task.taskType);

    try {
      const result = await requestStructuredData<TResult>({
        profileId: task.profileId,
        input: task.input,
        runtimeInstructions: task.runtimeInstructions,
        schemaName: task.schemaName,
        schema: task.schema,
        ...(runtime ? { taskType: task.taskType } : {}),
      }, executionOptions);

      if (runtime) {
        recordAuxiliaryLlmInvocation(task.profileId, {
          id: randomUUID(),
          taskType: task.taskType,
          status: 'success',
          message: '辅助 LLM 调用成功。',
          happenedAt: new Date().toISOString(),
          model: runtime.model,
          baseUrl: runtime.baseUrl,
        });
      }

      return result;
    } catch (error) {
      if (runtime) {
        recordAuxiliaryLlmInvocation(task.profileId, {
          id: randomUUID(),
          taskType: task.taskType,
          status: 'error',
          message: error instanceof Error ? error.message : '辅助 LLM 调用失败。',
          happenedAt: new Date().toISOString(),
          model: runtime.model,
          baseUrl: runtime.baseUrl,
        });
      }
      throw error;
    }
  }
}

let auxiliaryLLMInvoker: AuxiliaryLLMInvoker = new DefaultAuxiliaryLLMInvoker();

export function getAuxiliaryLLMInvoker() {
  return auxiliaryLLMInvoker;
}

export function setAuxiliaryLLMInvokerForTests(invoker: AuxiliaryLLMInvoker) {
  auxiliaryLLMInvoker = invoker;
}

export function resetAuxiliaryLLMInvokerForTests() {
  auxiliaryLLMInvoker = new DefaultAuxiliaryLLMInvoker();
}
