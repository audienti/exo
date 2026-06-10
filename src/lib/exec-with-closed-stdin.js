// @ts-check

/**
 * Both CLI runtimes (claude and codex) read stdin when it is a pipe ("Reading
 * additional input from stdin..."), and execFile always wires stdin as a pipe
 * — left open, codex blocks until the timeout kills it. Close it immediately:
 * the prompt travels as an argument, never on stdin.
 *
 * Works with any execFile-shaped async implementation. promisify(execFile)
 * exposes the spawned process on the returned promise's `child` property;
 * hand-rolled wrappers must do the same for the close to take effect, while
 * test doubles without a `child` are tolerated as a no-op.
 *
 * @param {(cli: string, args: string[], options: object) => Promise<{ stdout: string | Buffer, stderr: string | Buffer }>} execFileImpl
 * @param {string} cli
 * @param {string[]} args
 * @param {object} options
 */
export function execWithClosedStdin(execFileImpl, cli, args, options) {
  const pending = execFileImpl(cli, args, options);
  /** @type {{ child?: { stdin?: { end: () => void } } }} */ (pending).child?.stdin?.end();
  return pending;
}
