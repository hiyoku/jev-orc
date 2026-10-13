import { expect, test } from 'claude-code/testing'
import { createLimiter } from './limiter'

// Manual clock: sleep() resolves only when the test calls tick(); abort also resolves it.
function clock() {
  const sleeps: (() => void)[] = []
  const sleep = (_ms: number, signal: AbortSignal) =>
    new Promise<void>((r) => {
      sleeps.push(r)
      signal.addEventListener('abort', () => r())
    })
  return { sleep, tick: () => sleeps.forEach((r) => r()) }
}

test('within the limit: acquire is true without waiting', async () => {
  const { sleep } = clock()
  const limiter = createLimiter(1, 1000)
  expect(await limiter.acquire(sleep)).toBe(true)
})

test('above the limit: the second acquire waits until a release grants it', async () => {
  const { sleep } = clock()
  const limiter = createLimiter(1, 1000)
  await limiter.acquire(sleep)
  let result: boolean | undefined
  const second = limiter.acquire(sleep).then((r) => (result = r))
  await Promise.resolve()
  expect(result).toBe(undefined)
  limiter.release()
  await second
  expect(result).toBe(true)
})

test('timeout: without a release the acquire is false and the queue is empty', async () => {
  const { sleep, tick } = clock()
  const limiter = createLimiter(1, 1000)
  await limiter.acquire(sleep)
  const second = limiter.acquire(sleep)
  tick()
  expect(await second).toBe(false)
  // the queue is empty: releasing frees the slot instead of granting a ghost waiter
  limiter.release()
  expect(await limiter.acquire(sleep)).toBe(true)
})

test('maxWaitMs <= 0 with the limit full: false at once', async () => {
  const { sleep } = clock()
  const limiter = createLimiter(1, 0)
  await limiter.acquire(sleep)
  expect(await limiter.acquire(sleep)).toBe(false)
})
