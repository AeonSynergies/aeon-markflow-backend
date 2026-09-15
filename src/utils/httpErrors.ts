const STATUS_BY_ERROR_NAME: Record<string, number> = {
  WorkflowTemplateNotFoundError: 404,
  SavedListNotFoundError: 404,
  EmailTemplateNotFoundError: 404,
  EmailTemplateVersionNotFoundError: 404,
  EmptyWorkflowTemplateError: 400,
  CrossOrgReferenceError: 400,
  ValidationError: 400, // Mongoose schema validation
  CastError: 400, // Mongoose bad ObjectId, etc.
  UnauthorizedApproverRoleError: 403,
  InvalidTemplateVersionTransitionError: 400,
};

/** Maps a thrown error to an HTTP status code for the global Express error handler. */
export function statusForError(error: unknown): number {
  if (error instanceof Error && error.name in STATUS_BY_ERROR_NAME) {
    return STATUS_BY_ERROR_NAME[error.name];
  }
  return 500;
}
