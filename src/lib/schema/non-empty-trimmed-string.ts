import { Schema } from 'effect';

export const NonEmptyTrimmedString = Schema.NonEmptyString.check(
  Schema.isTrimmed(),
);
