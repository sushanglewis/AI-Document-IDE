import os
import pytest

def test_haha_file_exists():
    assert os.path.exists('/workspace/哈哈.md'), "File 哈哈.md does not exist"

def test_haha_file_content():
    with open('/workspace/哈哈.md', 'r') as f:
        content = f.read()
    assert '# 哈哈' in content
    assert '这是一个示例Markdown文件。' in content