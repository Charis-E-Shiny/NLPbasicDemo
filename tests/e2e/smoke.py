"""Browser smoke test for the built app (drives the real UI).

    npm run build && npx vite preview --port 4173 &
    python tests/e2e/smoke.py http://localhost:4173/
"""
import re
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"
ARGS = ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
failures = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        failures.append(msg)


def command(pg, text):
    pg.fill('textarea[aria-label="Natural-language design command"]', text)
    pg.click("button.generate")
    pg.wait_for_timeout(350)


def status_text(pg):
    # the status line is the element immediately after the command bar; search body text instead
    return pg.inner_text("body")


def object_count(pg):
    m = re.search(r"objects \((\d+)\)", status_text(pg), re.I)
    return int(m.group(1)) if m else -1


with sync_playwright() as p:
    browser = p.chromium.launch(args=ARGS)
    pg = browser.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and "GL" not in m.text else None)
    pg.goto(URL)
    pg.wait_for_selector('textarea[aria-label="Natural-language design command"]', timeout=60000)
    pg.wait_for_timeout(2500)

    command(pg, "create a 120 cm table")
    check("Created Table" in status_text(pg), "create a table (status message)")
    check(object_count(pg) >= 1, "table appears in the object list")

    command(pg, "add a red chair next to the table")
    check("Created Chair" in status_text(pg), "relative placement creates a chair")

    command(pg, "add an arduino uno")
    check("Created Arduino" in status_text(pg), "Arduino UNO board is created")

    command(pg, "make the table 140 cm wide")
    check("Updated Table" in status_text(pg), "resize updates the table")

    command(pg, "delete the chair")
    check("Removed Chair" in status_text(pg), "delete removes the chair")

    command(pg, "undo")
    check("Undid" in status_text(pg) or "Undone" in status_text(pg), "undo reverts the last change")

    command(pg, "xyzzy plugh frobnicate")
    check("not sure" in status_text(pg), "nonsense gets a clear 'not sure' message")

    command(pg, "help")
    check("Try:" in status_text(pg), "help lists examples")

    command(pg, "clear the scene")
    check("Cleared" in status_text(pg) and object_count(pg) == 0, "clear the scene empties the list")

    with pg.expect_download() as dl:
        command(pg, "export as stl")
    check(dl.value.suggested_filename.endswith(".s") or dl.value.suggested_filename.endswith(".stl"),
          f"export as STL downloads a file ({dl.value.suggested_filename})")

    check(not errors, "no uncaught page errors: " + ("; ".join(errors[:3]) or "none"))
    browser.close()

if failures:
    print(f"\n{len(failures)} check(s) failed")
    sys.exit(1)
print("\nall browser checks passed")
