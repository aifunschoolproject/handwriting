"""Consumer-visible pronunciation boundaries; run with Python unittest."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('annotations', Path(__file__).with_name('build-pdf-annotations.py'))
annotations = importlib.util.module_from_spec(spec)
spec.loader.exec_module(annotations)


class ContextPronunciationTests(unittest.TestCase):
    def test_consumes_complete_words_without_reverting_to_single_character(self):
        vocab = {'銀行': {('ㄧㄣˊ', 'ㄏㄤˊ')}, '行為': {('ㄒㄧㄥˊ', 'ㄨㄟˊ')},
                 '行': {('ㄏㄤˊ',), ('ㄒㄧㄥˊ',)}}
        tokens = annotations.annotate('銀行、行為', '行\tㄒㄧㄥˊ', 'example', vocab, {}, set())
        self.assertEqual([t['reading'] for t in tokens],
                         ['ㄧㄣˊ', 'ㄏㄤˊ', '', 'ㄒㄧㄥˊ', 'ㄨㄟˊ'])

    def test_unreviewed_ambiguous_reading_stops_generation(self):
        with self.assertRaisesRegex(ValueError, 'Unreviewed reading'):
            annotations.annotate('行', '行\tㄒㄧㄥˊ', 'example',
                                 {'行': {('ㄏㄤˊ',), ('ㄒㄧㄥˊ',)}}, {}, set())

    def test_review_does_not_leak_into_different_context(self):
        key = '子\tㄗˇ'
        vocab = {'子': {('ㄗˇ',), ('˙ㄗ',)}, '曰': {('ㄩㄝ',)}}
        context = annotations.review_key(key, 'example', '子曰', 0, '子')
        reviews = {context: ('ㄗˇ',)}
        tokens = annotations.annotate('子曰', key, 'example', vocab, reviews, set())
        self.assertEqual(tokens[0]['reading'], 'ㄗˇ')
        with self.assertRaisesRegex(ValueError, 'Unreviewed reading'):
            annotations.annotate('子', key, 'example', vocab, reviews, set())


if __name__ == '__main__':
    unittest.main()
