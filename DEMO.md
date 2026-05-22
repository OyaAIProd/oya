# Capturing demo assets

A GIF at the top of the README is the single biggest driver of stars/shares. Two
to make — the **studio** (the money shot) and a **terminal** clip (reproducible).

## 1. Studio GIF (the money shot)

Shows the live DAG lighting up + the answer streaming.

```bash
make dev      # → http://localhost:4000  (set ANTHROPIC_API_KEY for real runs; canned otherwise)
```

Record the browser with [Kap](https://getkap.co) (mac) or the Chrome DevTools
Recorder / QuickTime, then convert to GIF:

- Frame the three columns; window ~1280×800.
- Type a prompt (or click a suggestion), hit enter.
- Capture **~8–10s**: nodes go amber→green, handles show `OPAQUE → hidden` /
  `TRANSPARENT`, the answer streams.
- Trim to a tight loop. Save as `studio.gif`, drop it at the top of `README.md`.

Tip for a clean take: `ANTHROPIC_API_KEY` set → real, varied answers; unset →
canned + instant (more deterministic for a loop).

## 2. Terminal GIF (reproducible, no recording)

[`demo.tape`](./demo.tape) renders `make demo` to a GIF with
[VHS](https://github.com/charmbracelet/vhs) — no manual screen capture:

```bash
brew install vhs
vhs demo.tape        # → demo.gif
```

`make demo` itself (no key, deterministic) prints the plan executing — each node
with its projection level, then the streamed answer, then "the PDF and web page
stayed OPAQUE — the model never read them." Good for a tweet or the README.

## Where to put them

```md
<p align="center"><img src="./studio.gif" width="800" alt="oya Studio"></p>
```

Lead the README with the studio GIF; use the terminal GIF in the launch thread
(see [`LAUNCH.md`](./LAUNCH.md)).
