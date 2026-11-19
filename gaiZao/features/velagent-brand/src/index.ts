/**
 * VelAgent brand layer, host half.
 *
 * The visual work runs in the browser half; the host half exists so the bundle
 * contributes one loader row (the client module loads from this package).
 */
export const name = 'velagent-brand'

/** No host services are needed; the layer is purely visual. */
export const inject: string[] = []

/** No-op host plugin body. */
export function apply(): void {}
