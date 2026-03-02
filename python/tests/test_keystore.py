import json
import os
import tempfile
import shutil

import pytest

from keystore.keystore import Keystore
from keystore.keystore_proto import encode_keystore_data, decode_keystore_data


# ---------- fixtures ----------

@pytest.fixture
def tmp_dir():
    d = tempfile.mkdtemp(prefix="ks-test-")
    yield d
    shutil.rmtree(d, ignore_errors=True)


def tmp_file(tmp_dir, name):
    return os.path.join(tmp_dir, name)


# ============================================================
# Protobuf encode / decode
# ============================================================

class TestKeystoreProto:
    def test_roundtrip_empty(self):
        buf = encode_keystore_data({})
        assert len(buf) == 0
        assert decode_keystore_data(buf) == {}

    def test_roundtrip_single_entry(self):
        data = {"privateKey": "abc123"}
        buf = encode_keystore_data(data)
        assert len(buf) > 0
        assert decode_keystore_data(buf) == data

    def test_roundtrip_multiple_entries(self):
        data = {
            "privateKey": "deadbeef",
            "secretKey": "super-secret",
            "address": "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
        }
        buf = encode_keystore_data(data)
        assert decode_keystore_data(buf) == data

    def test_unicode_values(self):
        data = {"note": "hello world \U0001f600", "key": "\u00e9\u00e8\u00ea"}
        buf = encode_keystore_data(data)
        assert decode_keystore_data(buf) == data

    def test_truncated_buffer_raises(self):
        data = {"key": "value"}
        buf = encode_keystore_data(data)
        truncated = buf[: len(buf) - 3]
        with pytest.raises(ValueError):
            decode_keystore_data(truncated)


# ============================================================
# Keystore class — unencrypted (protobuf)
# ============================================================

class TestKeystoreUnencrypted:
    def test_read_nonexistent_file(self, tmp_dir):
        ks = Keystore(file_path=tmp_file(tmp_dir, "nonexistent"))
        data = ks.read()
        assert data == {}

    def test_write_and_read_protobuf(self, tmp_dir):
        fp = tmp_file(tmp_dir, "ks1")
        ks = Keystore(file_path=fp)
        ks.read()
        ks.set("privateKey", "abc")
        ks.write()

        # File should be binary protobuf, not JSON
        raw = open(fp, "rb").read()
        with pytest.raises(json.JSONDecodeError):
            json.loads(raw.decode("utf-8"))

        # Read back with a fresh instance
        ks2 = Keystore(file_path=fp)
        data = ks2.read()
        assert data == {"privateKey": "abc"}

    def test_set_without_read_preserves_existing(self, tmp_dir):
        fp = tmp_file(tmp_dir, "ks-preserve")
        Keystore.to_file(fp, {"existingKey": "existingVal"})

        ks = Keystore(file_path=fp)
        ks.set("newKey", "newVal")  # auto-loads
        ks.write()

        result = Keystore.from_file(fp)
        assert result == {"existingKey": "existingVal", "newKey": "newVal"}

    def test_get_missing_key(self, tmp_dir):
        fp = tmp_file(tmp_dir, "ks-get")
        Keystore.to_file(fp, {"a": "1"})
        ks = Keystore(file_path=fp)
        assert ks.get("a") == "1"
        assert ks.get("b") is None

    def test_keys(self, tmp_dir):
        fp = tmp_file(tmp_dir, "ks-keys")
        Keystore.to_file(fp, {"x": "1", "y": "2", "z": "3"})
        ks = Keystore(file_path=fp)
        assert sorted(ks.keys()) == ["x", "y", "z"]

    def test_get_all_returns_copy(self, tmp_dir):
        fp = tmp_file(tmp_dir, "ks-copy")
        Keystore.to_file(fp, {"k": "v"})
        ks = Keystore(file_path=fp)
        snapshot = ks.get_all()
        snapshot["k"] = "modified"
        assert ks.get("k") == "v"

    def test_atomic_write(self, tmp_dir):
        fp = tmp_file(tmp_dir, "ks-atomic")
        Keystore.to_file(fp, {"a": "b"})
        assert not os.path.exists(fp + ".tmp")
        assert os.path.exists(fp)

    def test_creates_parent_directories(self, tmp_dir):
        fp = os.path.join(tmp_dir, "deep", "nested", "Keystore")
        Keystore.to_file(fp, {"k": "v"})
        assert os.path.exists(fp)
        assert Keystore.from_file(fp) == {"k": "v"}


# ============================================================
# Keystore — legacy JSON backward compatibility
# ============================================================

class TestKeystoreLegacyJson:
    def test_read_legacy_json(self, tmp_dir):
        fp = tmp_file(tmp_dir, "ks-legacy")
        with open(fp, "w") as f:
            json.dump({"oldKey": "oldVal"}, f)
        ks = Keystore(file_path=fp)
        data = ks.read()
        assert data == {"oldKey": "oldVal"}

    def test_overwrite_legacy_json_with_protobuf(self, tmp_dir):
        fp = tmp_file(tmp_dir, "ks-legacy-overwrite")
        with open(fp, "w") as f:
            json.dump({"a": "1"}, f)

        ks = Keystore(file_path=fp)
        ks.read()
        ks.set("b", "2")
        ks.write()

        # File should now be protobuf
        raw = open(fp, "rb").read()
        with pytest.raises(json.JSONDecodeError):
            json.loads(raw.decode("utf-8"))

        result = Keystore.from_file(fp)
        assert result == {"a": "1", "b": "2"}
