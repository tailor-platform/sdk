import os, pty, select, sys, time

# argv: <wait-for text> <input bytes as hex> <timeout s> <command...>
wait_for, send_hex, timeout, *cmd = sys.argv[1:]
env = {k: v for k, v in os.environ.items() if not k.startswith("TAILOR") and k not in ("CI", "GITHUB_ACTIONS")}
pid, fd = pty.fork()
if pid == 0:
    os.execvpe(cmd[0], cmd, env)
out = b""
sent = False
start = time.time()
while True:
    ready, _, _ = select.select([fd], [], [], 0.2)
    if ready:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        out += chunk
    if not sent and wait_for.encode() in out:
        os.write(fd, bytes.fromhex(send_hex))
        sent = True
    if time.time() - start > float(timeout):
        os.kill(pid, 9)
        break
_, status = os.waitpid(pid, 0)
sys.stdout.write(f"{os.waitstatus_to_exitcode(status)}\n")
sys.stdout.write(out.decode(errors="replace"))
