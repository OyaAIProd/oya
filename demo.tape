# Reproducible terminal-demo GIF for the README.
# Install VHS (https://github.com/charmbracelet/vhs): brew install vhs
# Then:  vhs demo.tape   →   demo.gif

Output demo.gif

Require bun
Set Shell bash
Set FontSize 18
Set Width 1120
Set Height 620
Set Padding 30
Set Theme "Catppuccin Mocha"

Type "make demo" Sleep 600ms Enter
Sleep 7s
