/**
 * Single-flight async lock so parallel 401s do not stampede /auth/refresh.
 */
export function createSingleFlight<T>() {
  let inFlight: Promise<T> | null = null;

  return async function run(runner: () => Promise<T>): Promise<T> {
    if (!inFlight) {
      inFlight = (async () => {
        try {
          return await runner();
        } finally {
          inFlight = null;
        }
      })();
    }
    return inFlight;
  };
}
