"""Shared test fixtures."""

from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixtures_dir():
    return FIXTURES_DIR


@pytest.fixture
def hello_world_path(fixtures_dir):
    return fixtures_dir / "hello_world.deepnote"


@pytest.fixture
def multi_block_path(fixtures_dir):
    return fixtures_dir / "multi_block.deepnote"


@pytest.fixture
def with_inputs_path(fixtures_dir):
    return fixtures_dir / "with_inputs.deepnote"


@pytest.fixture
def multi_notebook_path(fixtures_dir):
    return fixtures_dir / "multi_notebook.deepnote"


@pytest.fixture
def with_error_path(fixtures_dir):
    return fixtures_dir / "with_error.deepnote"


@pytest.fixture
def async_code_path(fixtures_dir):
    return fixtures_dir / "async_code.deepnote"
