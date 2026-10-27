"""Rebuild from a local books-wiki checkout: python3 scripts/build-lullaby-catalog.py PATH."""
import json, re, sys
from pathlib import Path
root = Path(sys.argv[1]) / 'content'
video_re = re.compile(r'(?:youtu\.be/|youtube(?:-nocookie)?\.com/(?:watch\?[^\s<>]*?v=|embed/|shorts/))([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])')
def has_scream(text):
    for link in re.findall(r'\[\[([^\]]+)\]\]', text):
        target = link.split('|')[0].split('#')[0].rstrip('/').split('/')[-1]
        alias = link.split('|')[-1]
        if target.casefold() == 'крик' or alias.casefold() == 'крик':
            return True
    return bool(re.search(r'(?im)(?:^|\s)#крик\b|^\s*-\s*[\'\"]?крик[\'\"]?\s*$', text))
records, blocked = [], set()
for path in sorted(root.rglob('*.md')):
    text = path.read_text(encoding='utf-8-sig')
    videos = list(dict.fromkeys(video_re.findall(text)))
    if has_scream(text):
        blocked.update(videos)
    rel = path.relative_to(root)
    if rel.parts[0] not in ('Поезія присутності', 'Коли шукаєш відповідь (проза))'):
        continue
    for video in videos:
        records.append(dict(title=re.sub(r'^\d+[.\s]*', '', path.stem).strip('«». '), book=re.sub(r'^\d+\s*', '', rel.parts[1]), video=video))
unique = {}
for item in records:
    if item['video'] not in blocked:
        unique.setdefault(item['video'], item)
items = sorted(unique.values(), key=lambda e: (e['book'], e['title']))
assert len(items) > 3
output = Path(__file__).resolve().parents[1] / 'public/lullaby-catalog.js'
output.write_text('// Generated from books-wiki; videos tagged [[Крик]] excluded across all copies.\nconst lullabyExcerpts = ' + json.dumps(items, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
print(json.dumps({'included':len(items),'excludedVideoIds':sorted(blocked)},ensure_ascii=False))
