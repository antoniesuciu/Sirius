/**
 * One run at a time. A call that arrives while one is running does not start a second in
 * parallel: it waits for it, then everyone who arrived meanwhile shares one more run, with the
 * latest arguments (idle, running, running-dirty). Within one JS runtime only.
 */
export function singleFlight<A extends unknown[], R>(
  run: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  let running: Promise<R> | null = null;
  let rerun: Promise<R> | null = null;
  let latest: A;
  const go = (args: A): Promise<R> => {
    const p = run(...args).finally(() => {
      if (running === p) running = null;
    });
    running = p;
    return p;
  };
  return (...args) => {
    if (!running && !rerun) return go(args);
    latest = args;
    rerun ??= (running as Promise<R>)
      .then(
        () => {},
        () => {},
      )
      .then(() => {
        rerun = null;
        return go(latest);
      });
    return rerun;
  };
}
