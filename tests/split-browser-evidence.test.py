import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("split_evidence", Path(__file__).resolve().parents[1] / "scripts/split-browser-evidence.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class EvidenceTransferTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.destination = self.root / "output"

    def tearDown(self):
        self.temp.cleanup()

    def run_split(self, **kwargs):
        return module.split_evidence(self.source, self.destination, {"sourceRunId": 37983082270}, **kwargs)

    def test_every_byte_and_hash_is_preserved_across_parts(self):
        originals = {"a.png": b"synthetic-a", "nested/b.json": b"{}", "c.webm": b"synthetic-video"}
        for name, contents in originals.items():
            file = self.source / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(contents)
        result = self.run_split(limit=18, single_limit=32)
        self.assertEqual(len(result["parts"]), 2)
        copied = {}
        for part in result["parts"]:
            self.assertLessEqual(part["bytes"], 18)
            for entry in part["files"]:
                data = (self.destination / part["name"] / entry["path"]).read_bytes()
                self.assertEqual(entry["sha256"], hashlib.sha256(data).hexdigest())
                copied[entry["path"]] = data
        self.assertEqual(copied, originals)
        self.assertEqual({name: (self.source / name).read_bytes() for name in originals}, originals)

    def test_larger_individual_file_is_isolated_without_reencoding(self):
        (self.source / "a.png").write_bytes(b"x" * 20)
        (self.source / "b.json").write_bytes(b"{}")
        result = self.run_split(limit=8, single_limit=24)
        self.assertEqual([p["bytes"] for p in result["parts"]], [20, 2])

    def test_unsupported_or_oversized_input_is_rejected_before_writing(self):
        file = self.source / "a.png"
        file.write_bytes(b"x" * 25)
        with self.assertRaises(ValueError):
            self.run_split(limit=8, single_limit=24)
        self.assertFalse(self.destination.exists())
        file.unlink()
        (self.source / "execute.py").write_text("raise RuntimeError('must never execute')")
        with self.assertRaises(ValueError):
            self.run_split()
        self.assertFalse(self.destination.exists())

    def test_symlink_and_existing_destination_are_rejected(self):
        (self.root / "outside.png").write_bytes(b"private")
        (self.source / "link.png").symlink_to(self.root / "outside.png")
        with self.assertRaises(ValueError):
            self.run_split()
        self.assertFalse(self.destination.exists())
        (self.source / "link.png").unlink()
        (self.source / "a.png").write_bytes(b"synthetic")
        self.destination.mkdir()
        with self.assertRaises(ValueError):
            self.run_split()


if __name__ == "__main__":
    unittest.main()
