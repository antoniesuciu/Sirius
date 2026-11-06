"""Regenerates the Android app's icons and widget preview from the desktop icon (one source)."""
from PIL import Image, ImageDraw, ImageFont

SRC = 'apps/desktop/src-tauri/icons/icon.png'
OUT = 'apps/mobile/assets/'
PAPER, PANEL, INK, MUTED = (235, 227, 209, 255), (244, 238, 225, 255), (26, 24, 20, 255), (95, 88, 73, 255)
logo = Image.open(SRC).convert('RGBA')
logo = logo.crop(logo.getbbox())


def placed(size, scale, ground):
    canvas = Image.new('RGBA', (size, size), ground)
    side = int(size * scale)
    art = logo.copy()
    art.thumbnail((side, side), Image.LANCZOS)
    canvas.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    return canvas


placed(1024, 0.72, PAPER).save(OUT + 'icon.png')
# Adaptive icons crop to a circle or squircle: keep the art inside the central 66%.
placed(1024, 0.58, (0, 0, 0, 0)).save(OUT + 'android-icon-foreground.png')
placed(1024, 0.8, (0, 0, 0, 0)).save(OUT + 'splash-icon.png')
# Android draws notification icons from alpha only, in white.
mono = placed(96, 0.9, (0, 0, 0, 0))
white = Image.new('RGBA', mono.size, (255, 255, 255, 0))
white.putalpha(mono.getchannel('A'))
white.save(OUT + 'notification-icon.png')

w, h = 500, 360
preview = Image.new('RGBA', (w, h), (0, 0, 0, 0))
d = ImageDraw.Draw(preview)
d.rounded_rectangle((0, 0, w - 1, h - 1), 40, fill=PANEL)
try:
    serif = lambda n: ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', n)
    big, small = serif(40), serif(28)
except OSError:
    big = small = ImageFont.load_default()
d.text((28, 22), 'Today', font=big, fill=INK)
d.text((w - 140, 34), '2 open', font=small, fill=MUTED)
for i, (task, done) in enumerate([('Derive the covariance update', False), ('Ten pages of Abbott', True), ('Walk before sunset', False)]):
    y = 100 + i * 78
    box = (30, y + 6, 62, y + 38)
    d.ellipse(box, outline=INK, width=3, fill=INK if done else None)
    d.text((82, y), task, font=small, fill=MUTED if done else INK)
preview.save(OUT + 'widget-preview/today.png')
print('icons and widget preview written')
