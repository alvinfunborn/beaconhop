#!/usr/bin/env python3
"""Opt-in, visible macOS regression. Run only in an authorized desktop session.

Compile fixture.swift and BeaconBridge.swift + main.swift into separate executables,
then pass --fixture and --driver. --expect-group-raise proves the pre-fix failure.
Only the two owned fixture processes receive test actions. Original focus is restored.
"""
import argparse
import atexit
import json
import plistlib
import select
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--driver", type=Path, required=True)
parser.add_argument("--fixture", type=Path, required=True)
parser.add_argument("--expect-group-raise", action="store_true")
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
server = subprocess.Popen([str(args.driver.resolve()), "--server"], stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE, text=True)

def stop_server():
    if server.poll() is None:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)

atexit.register(stop_server)

def driver(*parameters):
    server.stdin.write(json.dumps(list(parameters)) + "\n")
    server.stdin.flush()
    if not select.select([server.stdout], [], [], 35)[0]:
        raise TimeoutError("Native focus driver did not reply")
    line = server.stdout.readline()
    if not line:
        raise RuntimeError("Native focus driver exited")
    return json.loads(line)

def wait_for(fn, description):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        result = fn()
        if result:
            return result
        time.sleep(.1)
    raise AssertionError(description)

processes = []
report = {"cases": []}
original = driver()
temporary = tempfile.TemporaryDirectory(prefix="bh-window-focus-")
try:
    folder = temporary.name
    paths = [Path(folder) / name for name in ("a.json", "b.json")]
    for name, path in zip(("A", "B"), paths):
        bundle = Path(folder) / (name + ".app") / "Contents"
        (bundle / "MacOS").mkdir(parents=True)
        shutil.copy2(args.fixture, bundle / "MacOS" / "fixture")
        (bundle / "Info.plist").write_bytes(plistlib.dumps({"CFBundleExecutable": "fixture",
            "CFBundleIdentifier": "dev.beaconhop.focus-regression." + name,
            "CFBundleName": "BH focus QA " + name, "CFBundlePackageType": "APPL"}))
        processes.append(subprocess.Popen([str(bundle / "MacOS" / "fixture"), str(path), name],
                                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        wait_for(path.exists, "Fixture did not start")
    def read(index):
        return json.loads(paths[index].read_text())
    a, b = read(0), read(1)
    ids = [row["id"] for row in a["windows"] + b["windows"]]
    target, sibling, cover = ids[0], ids[1], ids[2]
    def command(index, text):
        if text.startswith("focus "):
            # Use the authorized AX bridge for setup, too. On macOS 14+, a
            # background fixture's NSApp.activate request may be denied unless
            # the active application explicitly yields activation to it.
            target_index = int(text.split()[1])
            current = read(index)
            setup = driver(current["pid"], current["windows"][target_index]["id"])
            assert setup["error"] is None, setup
            try:
                wait_for(lambda: read(index)["active"] and read(index)["windows"][target_index]["key"],
                         "Fixture lost focus during setup; desktop may be in use")
            except AssertionError:
                raise AssertionError({"setup": setup, "fixture": read(index), "live": driver()})
            return
        command_path = paths[index].with_suffix(paths[index].suffix + ".command")
        command_path.write_text(text)
        wait_for(lambda: not command_path.exists(), "Fixture did not process command")
        time.sleep(.3)
    def order(state):
        return [window for window in state["order"] if window in ids]
    def arrange():
        command(0, "focus 1")
        command(1, "focus 0")
        before = driver()
        assert order(before).index(cover) < order(before).index(sibling), before
        return before
    def activate(case, before):
        after = driver(a["pid"], target)
        record = {"case": case, "before": order(before), "after": order(after),
                  "error": after["error"], "focused": after["focused"], "pid": after["pid"], "expectedPid": a["pid"]}
        report["cases"].append(record)
        assert after["error"] is None, record
        assert after["pid"] == a["pid"] and after["focused"] == target, record
        assert order(after)[0] == target, record
        if args.expect_group_raise:
            assert order(after).index(sibling) < order(after).index(cover), record
        else:
            # Removing the selected window must leave every other fixture window in order.
            assert [w for w in order(after) if w != target] == [w for w in order(before) if w != target], record
        print(json.dumps({"completed": record}), flush=True)
        return after
    activate("background app", arrange())
    if not args.expect_group_raise:
        command(0, "focus 1")
        activate("already frontmost app", driver())
        arrange()
        command(0, "minimize 0")
        activate("minimized target", driver())
        assert not read(0)["windows"][0]["minimized"]
        arrange()
        visible_before_hide = order(driver())
        command(0, "hide")
        hidden_before = driver()
        hidden_after = driver(a["pid"], target)
        record = {"case": "hidden app", "before": order(hidden_before), "beforeHide": visible_before_hide,
                  "after": order(hidden_after), "error": hidden_after["error"],
                  "focused": hidden_after["focused"], "pid": hidden_after["pid"]}
        report["cases"].append(record)
        assert hidden_after["error"] is None and hidden_after["focused"] == target and hidden_after["pid"] == a["pid"], record
        assert order(hidden_after)[0] == target, record
        # An OS may leave the unselected window hidden; if restored, it must stay
        # behind the covering application rather than being promoted with target.
        if sibling in order(hidden_after):
            assert [w for w in order(hidden_after) if w != target] == [w for w in visible_before_hide if w != target], record
        print(json.dumps({"completed": record}), flush=True)
        command(0, "close 0")
        closed = driver(a["pid"], target)
        assert closed["error"] == "The selected window has closed.", closed
        report["cases"].append({"case": "closed target", "error": closed["error"]})
    report["passed"] = True
except Exception as error:
    report["failure"] = str(error)
    raise
finally:
    # Restore before closing fixtures, while their ownership of focus is observable.
    try:
        if driver()["pid"] in [p.pid for p in processes]:
            report["restoredFocus"] = driver(original["pid"], original["focused"])
        else:
            report["restoreSkipped"] = "Focus changed outside owned fixtures"
    except Exception as error:
        report["restoreError"] = str(error)
    for process in processes:
        process.terminate()
    for process in processes:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    report["fixturesStopped"] = all(p.poll() is not None for p in processes)
    temporary.cleanup()
    stop_server()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
