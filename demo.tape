# demo.tape — records the paced "plan, don't react" terminal demo into demo.gif.
# Deterministic, no API key. Regenerate with:  vhs demo.tape
#
#   brew install vhs        # one-time (pulls ttyd + ffmpeg)
#   vhs demo.tape           # writes demo.gif

Output demo.gif
Require bun

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 720
Set Padding 28
Set Theme "Catppuccin Mocha"
Set TypingSpeed 55ms

Hide
Type "cd packages/core && clear"
Enter
Show

Type "bun run demo"
Enter
Sleep 7s
