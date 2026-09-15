import { statusForError } from '../../src/utils/httpErrors';

describe('statusForError', () => {
  it('maps known error names to their status code', () => {
    class WorkflowTemplateNotFoundError extends Error {
      constructor() {
        super('nope');
        this.name = 'WorkflowTemplateNotFoundError';
      }
    }
    expect(statusForError(new WorkflowTemplateNotFoundError())).toBe(404);
  });

  it('maps Mongoose ValidationError and CastError to 400', () => {
    const validationError = Object.assign(new Error('bad'), { name: 'ValidationError' });
    const castError = Object.assign(new Error('bad id'), { name: 'CastError' });
    expect(statusForError(validationError)).toBe(400);
    expect(statusForError(castError)).toBe(400);
  });

  it('defaults to 500 for an unrecognized error', () => {
    expect(statusForError(new Error('mystery'))).toBe(500);
  });

  it('defaults to 500 for a non-Error value', () => {
    expect(statusForError('just a string')).toBe(500);
  });
});
