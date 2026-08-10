import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

// A filesystem path handed to a child process, not a module specifier, so `#server.js` cannot
// stand in for it.
const SERVER = fileURLToPath(new URL('../src/server.ts', import.meta.url))
const dbPath = join(tmpdir(), `diele-server-test-${process.pid}.db`)

let child: ChildProcessWithoutNullStreams
let port: number
let output = ''

/**
 * Takes a port the operating system is willing to give out, then lets go of it again.
 * @returns {Promise<number>} - A port that was free a moment ago
 */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port: taken } = probe.address() as { port: number }
  await new Promise<void>((resolve) => probe.close(() => resolve()))

  return taken
}

/**
 * Waits for the process to print something matching, so a test never races the boot.
 * @param {RegExp} pattern - What to wait for
 * @returns {Promise<void>}
 */
function waitForOutput(pattern: RegExp): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`never printed ${pattern}:\n${output}`)),
      15_000,
    )

    const check = (): void => {
      if (pattern.test(output)) {
        clearTimeout(timer)
        resolve()
      }
    }

    child.stdout.on('data', check)
    child.stderr.on('data', check)
    check()
  })
}

before(async () => {
  port = await freePort()

  child = spawn(process.execPath, ['--import', 'tsx', '--conditions=development', SERVER], {
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      AUTH_MODE: 'dev',
      PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
      SESSION_COOKIE_SECURE: 'false',
      DIELE_VERSION: 'test-build',
    },
  })

  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })

  await waitForOutput(/diele api listening on/)
})

after(() => {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
  }

  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${dbPath}${suffix}`, { force: true })
  }
})

// The entry point is the one file no other test loads, so nothing else says whether the thing
// an operator actually runs comes up at all.
test('it boots, migrates a database of its own and says where it is listening', () => {
  assert.match(output, new RegExp(`listening on :${port}`))
  assert.match(output, /migrated to 1 \(init\)/)
  assert.ok(existsSync(dbPath), 'no database was created')
})

// On stderr, and therefore a stream of its own, so it can land a tick after the listening line.
test('it warns that a fixed identity is being handed out in dev mode', async () => {
  await waitForOutput(/AUTH_MODE=dev/)
})

// The build it reports is what an operator reads to tell which image answered, and it comes from
// the environment the image stamps rather than from anything in the tree.
test('it answers the status endpoint without a session, naming the build', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/status`)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok', version: 'test-build' })
})

// Deny-by-default: everything that reads data needs a session. The document at the root does not,
// because the sign-in screen is that document.
test('it holds the door on everything else', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/config`)

  assert.equal(response.status, 401)
})

// `docker stop` and a systemd restart both send this. Without a handler the process is hard
// killed, which cuts whatever was mid-response.
test('it stops cleanly on SIGTERM rather than being killed', async () => {
  const exit = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code))
  })

  child.kill('SIGTERM')

  assert.equal(await exit, 0)
  assert.match(output, /stopping on SIGTERM/)
})
