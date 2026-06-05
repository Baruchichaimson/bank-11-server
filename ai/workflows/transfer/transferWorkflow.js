import {
  buildNextTransferState,
  buildTransferGraphInitialState
} from '../../transferState.js';
import { transferStateMachine } from './transferStateMachine.js';

export const runTransferGraph = async ({
  userInput,
  userLanguage,
  userId,
  transferState,
  semanticIntent = 'unknown',
  transferPayload = null,
  correction = null,
  services,
  createChatCompletion,
  abortSignal
}) => {
  const result = await transferStateMachine.invoke(
    buildTransferGraphInitialState({
      userInput,
      userLanguage,
      userId,
      transferState,
      semanticIntent,
      transferPayload,
      correction
    }),
    {
      configurable: {
        services,
        createChatCompletion,
        abortSignal
      }
    }
  );

  return {
    handled: Boolean(result?.handled),
    reply: String(result?.reply || ''),
    action: result?.action || null,
    nextTransferState: buildNextTransferState(result)
  };
};
