export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>

// Semaphore over the JEV calls in flight. The host follows `$` only within spawn.ts, so the
// caller passes its sleep in.
export function createLimiter(parallelism: number, maxWaitMs: number) {
  let inFlight = 0
  const queue: (() => void)[] = []

  const acquire = async (sleep: Sleep): Promise<boolean> => {
    if (inFlight < parallelism) return (inFlight++, true)
    if (maxWaitMs <= 0) return false
    let grant!: () => void
    const granted = new Promise<void>((resolve) => (grant = resolve))
    queue.push(grant)
    const timer = new AbortController()
    await Promise.race([granted, sleep(maxWaitMs, timer.signal).catch(() => {})])
    timer.abort()
    const waiting = queue.indexOf(grant)
    if (waiting === -1) return true // granted, even if in the same tick as the timeout
    queue.splice(waiting, 1)
    return false
  }
  // A released slot passes straight to the next in the queue.
  const release = () => {
    const next = queue.shift()
    if (next) next()
    else inFlight--
  }
  return { acquire, release }
}
