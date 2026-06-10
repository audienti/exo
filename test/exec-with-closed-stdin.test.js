// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { execWithClosedStdin } from "../src/lib/exec-with-closed-stdin.js";

const execFileAsync = promisify(execFile);

test("closes the spawned child's stdin immediately and passes the result through", async () => {
  let endCalls = 0;
  /** @type {Array<{ cli: string, args: string[], options: object }>} */
  const calls = [];
  const execFileImpl = (cli, args, options) => {
    calls.push({ cli, args, options });
    const pending = Promise.resolve({ stdout: "ok", stderr: "" });
    return Object.assign(pending, {
      child: {
        stdin: {
          end: () => {
            endCalls += 1;
          }
        }
      }
    });
  };

  const result = await execWithClosedStdin(/** @type {any} */ (execFileImpl), "fake-cli", ["-p", "prompt"], { timeout: 1000 });

  assert.equal(endCalls, 1, "stdin must be closed exactly once, right after spawn");
  assert.deepEqual(result, { stdout: "ok", stderr: "" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cli, "fake-cli");
  assert.deepEqual(calls[0].args, ["-p", "prompt"]);
});

test("tolerates exec implementations without a child handle", async () => {
  const execFileImpl = async () => ({ stdout: "no child here", stderr: "" });

  const result = await execWithClosedStdin(/** @type {any} */ (execFileImpl), "fake-cli", [], {});
  assert.deepEqual(result, { stdout: "no child here", stderr: "" });
});

test("rejections from the exec implementation propagate unchanged", async () => {
  const failure = new Error("spawn fake-cli ENOENT");
  const execFileImpl = () => {
    const pending = Promise.reject(failure);
    return Object.assign(pending, { child: { stdin: { end: () => {} } } });
  };

  await assert.rejects(
    execWithClosedStdin(/** @type {any} */ (execFileImpl), "fake-cli", [], {}),
    failure
  );
});

test("a real child process sees stdin EOF instead of blocking until the timeout", async () => {
  // Mirrors the claude/codex CLI behavior: the child reads stdin to EOF before
  // answering. Without the stdin close it would idle until the watchdog fires.
  const script = [
    'const watchdog = setTimeout(() => { process.stderr.write("stdin was left open"); process.exit(7); }, 20000);',
    "process.stdin.resume();",
    'process.stdin.on("end", () => { clearTimeout(watchdog); process.stdout.write("stdin-closed"); process.exit(0); });'
  ].join("\n");

  const { stdout } = await execWithClosedStdin(execFileAsync, process.execPath, ["-e", script], {
    timeout: 25000
  });
  assert.equal(String(stdout), "stdin-closed");
});
