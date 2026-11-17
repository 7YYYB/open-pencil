import type { Ref } from 'vue'

import { AgentSetupError, type AgentSetupProblem } from '@/app/ai/agents/setup/readiness'
import {
  EmptyImageAnalysisError,
  ImageAnalysisTimeoutError,
  VisionModelUnavailableError
} from '@/app/ai/attachment/image/analyze'
import { CloudAIUnavailableError } from '@/app/ai/models/runtime'

export interface SubmissionMessages {
  openSettings: string
  requestFailed: string
  visionUnavailable: string
  imageAnalysisTimeout?: string
  imageAnalysisEmpty?: string
  cloudUnavailable: string
  runSetup: string
  agentSetup: Record<AgentSetupProblem, string>
}

export interface SubmissionErrorOptions {
  messages: Ref<SubmissionMessages>
  reportError: (message: string, action?: { label: string; run: () => void }) => void
  openModelSettings: () => void
  openSetup: () => void
}

/** Explains why a message could not be sent, with the fix when there is one. */
export function reportSubmissionError(options: SubmissionErrorOptions, error: unknown): void {
  console.error('Chat error:', error)
  if (error instanceof AgentSetupError) {
    options.reportError(options.messages.value.agentSetup[error.problem], {
      label: options.messages.value.runSetup,
      run: options.openSetup
    })
    return
  }
  if (error instanceof CloudAIUnavailableError) {
    options.reportError(options.messages.value.cloudUnavailable, {
      label: options.messages.value.openSettings,
      run: options.openModelSettings
    })
    return
  }
  if (error instanceof VisionModelUnavailableError) {
    options.reportError(options.messages.value.visionUnavailable, {
      label: options.messages.value.openSettings,
      run: options.openModelSettings
    })
    return
  }
  if (error instanceof ImageAnalysisTimeoutError || error instanceof EmptyImageAnalysisError) {
    const message =
      error instanceof ImageAnalysisTimeoutError
        ? options.messages.value.imageAnalysisTimeout
        : options.messages.value.imageAnalysisEmpty
    options.reportError(message ?? options.messages.value.requestFailed, {
      label: options.messages.value.openSettings,
      run: options.openModelSettings
    })
    return
  }
  options.reportError(options.messages.value.requestFailed)
}
