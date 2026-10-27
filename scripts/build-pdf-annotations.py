#!/usr/bin/env python3
"""Build-only PDF annotation snapshot; never infer an ambiguous first reading.

Sources: MOE 國語辭典簡編本 XLSX (注音一式), dict.js first definition and
original first example, and 國語小字典 部首字音讀表 (scripts/moe-radicals.json).
哏 ㄍㄣˊ is absent from the concise export; its existing headword reading
was checked at https://dict.revised.moe.edu.tw/dictView.jsp?ID=4093 .
Keep its unavailable concise definition/stroke count absent, not invented.
Context decisions are pinned to the complete original text, lesson reading,
section, offset and word in pdf-pronunciation-overrides.json. New/changed
ambiguous content must be reviewed explicitly; it cannot inherit a default.
Run: python scripts/build-pdf-annotations.py (requires openpyxl).
The generated JS is committed; the Pages/Chromium build needs no Python.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HAN = re.compile(r'[\u3400-\u9fff\U00020000-\U0003134f]')
SYLLABLE = re.compile(r'˙?[ㄅ-ㄩ]+[ˊˇˋ˙]?')
INLINE_READING = re.compile(r'[（(][ㄅ-ㄩˊˇˋ˙\s]+[）)]')


def load_js(name):
    return json.loads((ROOT / name).read_text(encoding='utf-8').split('=', 1)[1].strip().rstrip(';'))


def load_vocab(path):
    import openpyxl
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    vocab = {}
    try:
        for row in book.active.iter_rows(min_row=2, values_only=True):
            word = str(row[0] or '').strip()
            readings = tuple(SYLLABLE.findall(str(row[6] or '')))
            if word and len(word) == len(readings):
                vocab.setdefault(word, set()).add(readings)
    finally:
        book.close()
    return vocab


def review_key(key, kind, text, offset, word):
    return key, kind, text, offset, word


def load_reviews():
    records = json.loads((ROOT / 'scripts/pdf-pronunciation-overrides.json').read_text(encoding='utf-8'))
    reviews = {}
    for item in records:
        key = review_key(*(item[field] for field in ('key', 'kind', 'text', 'offset', 'word')))
        reading = tuple(item['reading'])
        if key in reviews or len(reading) != len(item['word']):
            raise ValueError(f'Duplicate or invalid contextual review: {key}')
        if any(SYLLABLE.fullmatch(syllable) is None for syllable in reading):
            raise ValueError(f'Invalid reviewed syllable: {key}')
        reviews[key] = reading
    return reviews


def annotate(text, key, kind, vocab, reviews, used):
    tokens = []
    offset = 0
    omitted = {i for match in INLINE_READING.finditer(text) for i in range(match.start(), match.end())}
    while offset < len(text):
        char = text[offset]
        if not HAN.fullmatch(char):
            if offset not in omitted and char not in '◎△':
                tokens.append({'text': char, 'reading': ''})
            offset += 1
            continue
        word = char
        for length in range(min(12, len(text) - offset), 1, -1):
            candidate = text[offset:offset + length]
            if candidate in vocab:
                word = candidate
                break
        candidates = vocab.get(word, set())
        context = review_key(key, kind, text, offset, word)
        if context in reviews:
            reading = reviews[context]
            used.add(context)
        elif len(candidates) == 1:
            reading = next(iter(candidates))
        else:
            raise ValueError(f'Unreviewed reading: {context}; candidates={sorted(candidates)}')
        # Consume the WHOLE matched word, preserving its contextual syllables.
        tokens.extend({'text': glyph, 'reading': syllable} for glyph, syllable in zip(word, reading))
        offset += len(word)
    return tokens


def make_annotations(data, dictionary, vocab, reviews, radicals):
    pairs = sorted({(ch['name'], ch['zhuYin'])
                    for grades in data.values() for semesters in grades.values()
                    for courses in semesters.values() for chars in courses.values() for ch in chars})
    annotations = {}
    used = set()
    for name, lesson_reading in pairs:
        key = name + '\t' + lesson_reading
        entry = dictionary[name]
        # MOE quantifier 個 is ㄍㄜˋ; the lesson's neutral form has no headword entry.
        canonical = 'ㄍㄜˋ' if key == '個\t˙ㄍㄜ' else lesson_reading
        reading = next((r for r in entry['readings'] if r['z'] == canonical), None)
        if reading is None:
            raise ValueError(f'MOE headword reading not found: {key}')
        radical = entry['radical']
        if radical not in radicals:
            raise ValueError(f'MOE radical reading not found: {radical} ({key})')
        meta = []
        if entry.get('strokes') is not None:
            meta.extend({'text': c, 'reading': ''} for c in str(entry['strokes']))
            meta.extend([{'text': '畫', 'reading': 'ㄏㄨㄚˋ'}, {'text': '，', 'reading': ''}])
        # Use the official radical name; variant component glyphs are not
        # covered consistently by the bundled font on Windows and Linux.
        meta.extend([{'text': '部', 'reading': 'ㄅㄨˋ'}, {'text': '首', 'reading': 'ㄕㄡˇ'},
                     {'text': '：', 'reading': ''}, {'text': radical, 'reading': radicals[radical]}])
        sections = [{'kind': 'meta', 'tokens': meta}]
        definitions = reading.get('defs', [])
        definition = definitions[0]['d'] if definitions else ''
        example = reading.get('ex', '').split('、')[0]
        for kind, text in [('definition', definition), ('example', example)]:
            if text:
                tokens = annotate(text, key, kind, vocab, reviews, used)
                if kind == 'example':
                    tokens = [{'text': '例', 'reading': 'ㄌㄧˋ'}, {'text': '：', 'reading': ''}] + tokens
                sections.append({'kind': kind, 'tokens': tokens})
        annotations[key] = {'reading': canonical, 'sections': sections}
    stale = set(reviews) - used
    if stale:
        raise ValueError(f'{len(stale)} stale review records; first: {sorted(stale)[0]}')
    return annotations


def main():
    vocab = load_vocab(ROOT / 'dict_concised_2014_20260929.xlsx')
    radicals = json.loads((ROOT / 'scripts/moe-radicals.json').read_text(encoding='utf-8'))['readings']
    reviews = load_reviews()
    annotations = make_annotations(load_js('data.js'), load_js('dict.js'), vocab, reviews, radicals)
    target = ROOT / 'scripts/pdf-annotations.js'
    header = ('/* Generated by scripts/build-pdf-annotations.py; build-only, not loaded by the app.\n'
              ' * Readings: MOE 國語辭典簡編本 注音一式 + exact-context reviewed decisions.\n'
              ' * Radicals: https://dict.mini.moe.edu.tw/SearchIndex/RadicalsTable\n'
              ' * Missing/ambiguous/stale decisions fail generation; no first-reading fallback. */\n')
    target.write_text(header + 'window.WORKSHEET_ANNOTATIONS = '
                      + json.dumps(annotations, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
                      + ';\n', encoding='utf-8', newline='\n')
    print(f'{len(annotations)} character/readings; {len(reviews)} reviewed contexts; '
          f'{len(radicals)} official radicals; {target.stat().st_size} bytes')


if __name__ == '__main__':
    main()
