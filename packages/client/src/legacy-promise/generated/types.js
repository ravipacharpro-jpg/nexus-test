export const isUnauthorizedError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnauthorizedError";
export const isInvalidRequestError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidRequestError";
export const isInvalidCursorError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidCursorError";
export const isSessionNotFoundError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SessionNotFoundError";
export const isMessageNotFoundError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "MessageNotFoundError";
export const isConflictError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ConflictError";
export const isCommandNotFoundError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "CommandNotFoundError";
export const isCommandEvaluationError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "CommandEvaluationError";
export const isSkillNotFoundError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SkillNotFoundError";
export const isServiceUnavailableError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ServiceUnavailableError";
export const isSessionBusyError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SessionBusyError";
export const isUnknownError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnknownError";
export const isInstructionEntryValueTooLargeError = (value) => typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    value["_tag"] === "InstructionEntryValueTooLargeError";
export const isProviderNotFoundError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ProviderNotFoundError";
export const isMcpServerNotFoundError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "McpServerNotFoundError";
export const isFormNotFoundError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FormNotFoundError";
export const isFormAlreadySettledError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FormAlreadySettledError";
export const isFormInvalidAnswerError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FormInvalidAnswerError";
export const isPermissionNotFoundError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PermissionNotFoundError";
export const isPtyNotFoundError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PtyNotFoundError";
export const isShellNotFoundError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ShellNotFoundError";
export const isQuestionNotFoundError = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "QuestionNotFoundError";
export const isProjectCopyError = (value) => typeof value === "object" && value !== null && "name" in value && value["name"] === "ProjectCopyError";
