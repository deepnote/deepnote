"""Tests for .deepnote YAML parser."""

import pytest

from deepnote_runtime.models import BlockType, ExecutionMode
from deepnote_runtime.parser import ParseError, parse_file, parse_string


class TestParseFile:
    def test_parse_hello_world(self, hello_world_path):
        result = parse_file(hello_world_path)
        assert result.version == "1.0.0"
        assert result.project.name == "Hello world"
        assert len(result.project.notebooks) == 1

        nb = result.project.notebooks[0]
        assert nb.name == "Main"
        assert nb.execution_mode == ExecutionMode.BLOCK
        assert len(nb.blocks) == 1

        block = nb.blocks[0]
        assert block.type == BlockType.CODE
        assert "Hello, World!" in block.content

    def test_parse_multi_block(self, multi_block_path):
        result = parse_file(multi_block_path)
        nb = result.project.notebooks[0]
        assert len(nb.blocks) == 4  # 3 code + 1 markdown

        code_blocks = nb.code_blocks
        assert len(code_blocks) == 3

        # Verify sorting
        assert code_blocks[0].id == "block-001"
        assert code_blocks[1].id == "block-002"
        assert code_blocks[2].id == "block-003"

    def test_parse_with_inputs(self, with_inputs_path):
        result = parse_file(with_inputs_path)
        nb = result.project.notebooks[0]

        input_blocks = nb.input_blocks
        assert len(input_blocks) == 2

        text_input = input_blocks[0]
        assert text_input.type == BlockType.INPUT_TEXT
        assert text_input.variable_name == "greeting"
        assert text_input.variable_value == "Hello"

        slider_input = input_blocks[1]
        assert slider_input.type == BlockType.INPUT_SLIDER
        assert slider_input.variable_name == "count"
        assert slider_input.variable_value == 3

    def test_parse_multi_notebook(self, multi_notebook_path):
        result = parse_file(multi_notebook_path)
        assert len(result.project.notebooks) == 2
        assert result.project.notebooks[0].name == "Setup"
        assert result.project.notebooks[1].name == "Analysis"

    def test_file_not_found(self):
        with pytest.raises(FileNotFoundError):
            parse_file("/nonexistent/file.deepnote")

    def test_wrong_extension(self, tmp_path):
        bad_file = tmp_path / "test.txt"
        bad_file.write_text("hello")
        with pytest.raises(ParseError, match="Expected .deepnote"):
            parse_file(bad_file)


class TestParseString:
    def test_minimal_valid(self):
        yaml_str = """
version: "1.0.0"
project:
  id: "test-id"
  name: "Test"
  notebooks: []
"""
        result = parse_string(yaml_str)
        assert result.version == "1.0.0"
        assert result.project.name == "Test"
        assert result.project.notebooks == []

    def test_missing_version(self):
        with pytest.raises(ParseError, match="version"):
            parse_string("project: {id: x, name: y}")

    def test_missing_project(self):
        with pytest.raises(ParseError, match="project"):
            parse_string('version: "1.0.0"')

    def test_invalid_yaml(self):
        with pytest.raises(ParseError, match="Invalid YAML"):
            parse_string("{{{{invalid yaml")

    def test_non_mapping_yaml(self):
        with pytest.raises(ParseError, match="mapping"):
            parse_string("- just\n- a\n- list")

    def test_unknown_block_type(self):
        yaml_str = """
version: "1.0.0"
project:
  id: "test-id"
  name: "Test"
  notebooks:
    - id: "nb-1"
      name: "NB"
      blocks:
        - id: "b-1"
          type: "unknown_type"
"""
        with pytest.raises(ParseError, match="Unknown block type"):
            parse_string(yaml_str)

    def test_block_with_outputs(self):
        yaml_str = """
version: "1.0.0"
project:
  id: "test-id"
  name: "Test"
  notebooks:
    - id: "nb-1"
      name: "NB"
      blocks:
        - id: "b-1"
          type: code
          content: "print('hi')"
          outputs:
            - output_type: stream
              name: stdout
              text: "hi\\n"
            - output_type: execute_result
              execution_count: 1
              data:
                text/plain: "'result'"
"""
        result = parse_string(yaml_str)
        block = result.project.notebooks[0].blocks[0]
        assert len(block.outputs) == 2
        assert block.outputs[0].output_type == "stream"
        assert block.outputs[0].name == "stdout"
        assert block.outputs[1].output_type == "execute_result"
        assert block.outputs[1].data["text/plain"] == "'result'"

    def test_block_output_to_dict(self):
        yaml_str = """
version: "1.0.0"
project:
  id: "test-id"
  name: "Test"
  notebooks:
    - id: "nb-1"
      name: "NB"
      blocks:
        - id: "b-1"
          type: code
          content: "42"
          outputs:
            - output_type: execute_result
              execution_count: 1
              data:
                text/plain: "42"
"""
        result = parse_string(yaml_str)
        output = result.project.notebooks[0].blocks[0].outputs[0]
        d = output.to_dict()
        assert d["output_type"] == "execute_result"
        assert d["data"]["text/plain"] == "42"
        assert d["execution_count"] == 1
