/**
 * Race `promise` against a timer. If the timer fires first, return `fallback`.
 * The original promise continues running — callers that need to cancel it must
 * handle that themselves (e.g. via AbortController). This helper is purely about
 * what VALUE is returned; it never throws.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    return result;
  } finally {
    clearTimeout(timer);
  }
}
