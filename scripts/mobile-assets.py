"""Regenerates the Android notification icon and widget previews. Launcher icon and splash:
scripts/mobile-icon.ts."""
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
rows = [('Derive the covariance update', False), ('Ten pages of Abbott', True), (None, False), ('Milk', False)]
for i, (task, done) in enumerate(rows):
    y = 92 + i * 64
    if task is None:
        d.text((30, y + 4), 'To remember', font=small, fill=INK)
        continue
    box = (30, y + 6, 62, y + 38)
    d.ellipse(box, outline=INK, width=3, fill=INK if done else None)
    d.text((82, y), task, font=small, fill=MUTED if done else INK)
preview.save(OUT + 'widget-preview/today.png')

# The small Today: the same widget, a row shorter, with its tighter header.
w2, h2 = 500, 240
small_preview = Image.new('RGBA', (w2, h2), (0, 0, 0, 0))
d2 = ImageDraw.Draw(small_preview)
d2.rounded_rectangle((0, 0, w2 - 1, h2 - 1), 40, fill=PANEL)
d2.text((28, 16), 'Today', font=big, fill=INK)
d2.text((w2 - 140, 28), '2 open', font=small, fill=MUTED)
for i, (task, done) in enumerate([('Derive the covariance update', False), ('Ten pages of Abbott', True)]):
    y = 82 + i * 64
    d2.ellipse((30, y + 6, 62, y + 38), outline=INK, width=3, fill=INK if done else None)
    d2.text((82, y), task, font=small, fill=MUTED if done else INK)
small_preview.save(OUT + 'widget-preview/today-small.png')

# The one-cell wolf widget: the logo on the panel, as the home screen shows it.
wolf = Image.new('RGBA', (180, 180), (0, 0, 0, 0))
ImageDraw.Draw(wolf).ellipse((0, 0, 179, 179), fill=PANEL)
art = logo.copy()
art.thumbnail((130, 130), Image.LANCZOS)
wolf.alpha_composite(art, ((180 - art.width) // 2, (180 - art.height) // 2))
wolf.save(OUT + 'widget-preview/wolf.png')
print('notification icon and widget previews written')
