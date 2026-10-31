import type { Request } from 'express';
import type { ZodTypeAny, z } from 'zod';

/** Parse + coerce; throws ZodError (-> 400 VALIDATION_ERROR). Unknown keys are stripped. */
export const body = <T extends ZodTypeAny>(schema: T, req: Request): z.infer<T> => schema.parse(req.body);
export const query = <T extends ZodTypeAny>(schema: T, req: Request): z.infer<T> => schema.parse(req.query);
export const idParam = (req: Request, name = 'id'): string => {
  const v = req.params[name];
  if (!/^[a-f\d]{24}$/i.test(v)) throw Object.assign(new RangeError(`Invalid ${name}`));
  return v;
};
