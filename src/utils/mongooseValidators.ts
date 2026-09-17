/** A schema field's own `kind`-like discriminant, whatever the field is actually named. */
type KindContext = { kind?: string };

/**
 * Builds a Mongoose `required` validator that only applies when the document's `kind` field is
 * one of the given values — e.g. `sending_domain` is required for an `email` WorkflowStep but
 * not a `wait` one. Shared by any schema with a `kind`-discriminated set of
 * conditionally-required fields (WorkflowStep, ReviewTask).
 */
export function requiredWhenKindIsOneOf(
  kinds: string[],
  message: string,
): [(this: KindContext) => boolean, string] {
  return [
    function requiredForKind(this: KindContext) {
      return this.kind !== undefined && kinds.includes(this.kind);
    },
    message,
  ];
}

/** Single-kind convenience wrapper around requiredWhenKindIsOneOf. */
export function requiredWhenKindIs(kind: string, message: string): [(this: KindContext) => boolean, string] {
  return requiredWhenKindIsOneOf([kind], message);
}
