# Builds site/index.html (local three.js and fonts, relay address baked in) from src/game.html.
# Run from the repo root: python3 tools/build.py
import os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(root, 'src', 'game.html')).read()
fonts = '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oxanium:wght@500;700;800&family=IBM+Plex+Mono:wght@400;600&display=swap">'
three = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'
assert fonts in src and three in src
out = src.replace(fonts, '<link rel="stylesheet" href="fonts.css">\n<script>window.KESSA_SERVER = "kessa-relay.retrohome.workers.dev";</script>').replace(three, '<script src="three.min.js"></script>')
head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n'
        '<style>html,body{margin:0}body{font-size:14px}[hidden]{display:none!important}img{max-width:100%}</style>\n')
open(os.path.join(root, 'site', 'index.html'), 'w').write(head + out + '\n</body>\n</html>\n')
print('built site/index.html')
