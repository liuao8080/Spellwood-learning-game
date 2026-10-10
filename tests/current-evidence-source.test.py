"""Exercise the workflow's exact packaging code in a real shallow merge clone.

All payloads, run IDs and artifact digests here are synthetic test fixtures.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
WORKFLOW = REPO / '.github/workflows/browser-acceptance.yml'


def workflow_python():
    text = WORKFLOW.read_text()
    start = text.index('          import importlib.util, json, os, re, shutil, subprocess')
    end = text.index('          PYTHON', start)
    return '\n'.join(line[10:] for line in text[start:end].splitlines())


class CurrentEvidenceSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='spellwood-current-evidence-')
        root = Path(self.temp.name)
        source = root / 'source'
        source.mkdir()
        identity = ['-c', 'user.name=Evidence Fixture', '-c', 'user.email=fixture@example.invalid']
        def git(*args):
            return subprocess.check_output(['git', *identity, *args], cwd=source, text=True, stderr=subprocess.DEVNULL).strip()
        git('init', '-q', '-b', 'main')
        (source / 'scripts').mkdir()
        shutil.copyfile(REPO / 'scripts/split-browser-evidence.py', source / 'scripts/split-browser-evidence.py')
        git('add', '.')
        git('commit', '-qm', 'Synthetic base')
        git('checkout', '-qb', 'feature')
        (source / 'feature.txt').write_text('feature')
        git('add', '.')
        git('commit', '-qm', 'Synthetic feature')
        self.pr_head = git('rev-parse', 'HEAD')
        git('checkout', '-q', 'main')
        (source / 'main.txt').write_text('main')
        git('add', '.')
        git('commit', '-qm', 'Synthetic main')
        git('merge', '--no-ff', '-qm', 'Synthetic merge', 'feature')
        self.checkout = git('rev-parse', 'HEAD')
        self.tree = git('rev-parse', 'HEAD^{tree}')
        self.clone = root / 'shallow'
        subprocess.run(['git', 'clone', '-q', '--depth', '1', source.as_uri(), str(self.clone)], check=True)
        hidden = subprocess.check_output(['git', 'show', '-s', '--format=%P', 'HEAD'], cwd=self.clone, text=True).strip()
        self.assertEqual(hidden, '', 'The fixture must reproduce shallow pretty-log parent suppression')
        evidence = self.clone / 'test-results/browser-evidence'
        evidence.mkdir(parents=True)
        (evidence / 'safe.json').write_text('{}')
        (evidence / 'safe.png').write_bytes(b'synthetic image bytes')
        (evidence / 'clip-arena-only.webm').write_bytes(b'synthetic arena bytes')
        (evidence / 'excluded.txt').write_text('not an allowed published artifact')
        self.env = {**os.environ, 'GITHUB_SHA': self.checkout, 'PR_HEAD': self.pr_head,
                    'GITHUB_RUN_ID': '456', 'GITHUB_RUN_ATTEMPT': '2',
                    'FULL_ARTIFACT_ID': '123', 'FULL_ARTIFACT_SHA256': '0' * 64}

    def tearDown(self):
        self.temp.cleanup()

    def run_packaging(self, **overrides):
        return subprocess.run(['python3', '-c', workflow_python()], cwd=self.clone,
                              env={**self.env, **overrides}, capture_output=True, text=True)

    def test_shallow_merge_binds_actual_tree_and_feature_parent(self):
        result = self.run_packaging()
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((self.clone / 'evidence-transfer-parts/manifest/source-and-file-hashes.json').read_text())
        self.assertEqual(manifest['source']['sourceHead'], self.pr_head)
        self.assertEqual(manifest['source']['checkoutHead'], self.checkout)
        self.assertEqual(manifest['source']['sourceTree'], self.tree)
        self.assertEqual(manifest['source']['sourceRunAttempt'], 2)
        self.assertEqual({entry['path'] for part in manifest['parts'] for entry in part['files']},
                         {'safe.json', 'safe.png', 'clip-arena-only.webm'})
        for part in manifest['parts']:
            for entry in part['files']:
                self.assertEqual((self.clone / 'evidence-transfer-parts' / part['name'] / entry['path']).read_bytes(),
                                 (self.clone / 'test-results/browser-evidence' / entry['path']).read_bytes())

    def test_wrong_pr_head_or_checkout_or_digest_is_rejected_before_copy(self):
        for override in ({'PR_HEAD': 'e' * 40}, {'GITHUB_SHA': 'f' * 40}, {'FULL_ARTIFACT_SHA256': 'invalid'}):
            with self.subTest(override=override):
                self.assertNotEqual(self.run_packaging(**override).returncode, 0)
                self.assertFalse((self.clone / 'evidence-transfer-source').exists())

    def test_explicit_manual_run_uses_actual_checkout(self):
        result = self.run_packaging(PR_HEAD='')
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((self.clone / 'evidence-transfer-parts/manifest/source-and-file-hashes.json').read_text())
        self.assertEqual(manifest['source']['sourceHead'], self.checkout)


if __name__ == '__main__':
    unittest.main()
