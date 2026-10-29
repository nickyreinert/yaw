"""macOS PTY bridge for the native agent; Python standard library only."""
import errno
import os
import pty
import select
import signal
import sys
import time


def main():
    child, master = pty.fork()
    if child == 0:
        try:
            os.execvpe(sys.argv[1], sys.argv[1:], os.environ)
        except OSError:
            os.write(2, b"Native executable could not start.\n")
            os._exit(127)

    stopping = None

    def terminate(_number, _frame):
        nonlocal stopping
        if stopping is None:
            stopping = time.monotonic()
            try:
                os.killpg(child, signal.SIGTERM)
            except ProcessLookupError:
                pass

    signal.signal(signal.SIGTERM, terminate)
    signal.signal(signal.SIGINT, terminate)
    inputs = [master, 0]
    status = None
    try:
        while True:
            if stopping is not None and time.monotonic() - stopping > 2:
                try:
                    os.killpg(child, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            ended, result = os.waitpid(child, os.WNOHANG)
            if ended:
                status = result
                break
            ready, _, _ = select.select(inputs, [], [], 0.1)
            for source in ready:
                try:
                    data = os.read(source, 8192)
                except OSError as error:
                    if source == master and error.errno == errno.EIO:
                        data = b""
                    else:
                        raise
                if not data:
                    if source == 0:
                        inputs.remove(0)
                        terminate(signal.SIGTERM, None)
                    else:
                        _, status = os.waitpid(child, 0)
                        return os.waitstatus_to_exitcode(status)
                else:
                    os.write(1 if source == master else master, data)
    finally:
        os.close(master)
        if status is None:
            try:
                os.killpg(child, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(child, 0)
    return os.waitstatus_to_exitcode(status)


if __name__ == "__main__":
    result = main()
    sys.exit(result if result >= 0 else 128 - result)
