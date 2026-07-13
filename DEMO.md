# Capturing the demo GIF

`demo.gif` (shown in the README hero) is a recording of the paced, deterministic
"plan, don't react" terminal demo in
[`packages/core/examples/demo.ts`](./packages/core/examples/demo.ts). It runs
against a canned local model — **no API key, same output every time** — so the GIF
is reproducible.

## Regenerate it

```bash
brew install vhs        # one-time; pulls ttyd + ffmpeg
vhs demo.tape           # writes demo.gif at the repo root
```

The recording is scripted in [`demo.tape`](./demo.tape) (size, theme, timing). To
preview the demo without recording:

```bash
make demo               # or: cd packages/core && bun run demo
```

## Swapping in the web Studio

To feature the live web Studio (the DAG + trace UI) instead of the terminal demo,
record `bunx oyadotai dev` (Studio at `localhost:4000`) with any screen recorder,
export a GIF, save it as `demo.gif`, and the README hero picks it up automatically.
