"""Integration tests — end-to-end execution of .deepnote files."""

import pytest

from deepnote_runtime.parser import parse_file
from deepnote_runtime.reactive import ReactiveEngine
from deepnote_runtime.shim import install_shim, uninstall_shim


@pytest.fixture(autouse=True)
def setup_shim():
    install_shim()
    yield
    uninstall_shim()


class TestEndToEnd:
    def test_hello_world(self, hello_world_path):
        df = parse_file(hello_world_path)
        engine = ReactiveEngine()
        result = engine.execute_notebook(df.project.notebooks[0])

        assert result.success
        outputs = result.block_results[0].outputs
        stream = [o for o in outputs if o.output_type == "stream"]
        assert len(stream) == 1
        assert "Hello, World!" in stream[0].text

    def test_multi_block_dependencies(self, multi_block_path):
        df = parse_file(multi_block_path)
        engine = ReactiveEngine()
        result = engine.execute_notebook(df.project.notebooks[0])

        assert result.success
        assert result.namespace["x"] == 10
        assert result.namespace["y"] == 20
        assert result.namespace["z"] == 30
        assert result.namespace["result"] == 60

    def test_input_blocks(self, with_inputs_path):
        df = parse_file(with_inputs_path)
        engine = ReactiveEngine()
        result = engine.execute_notebook(df.project.notebooks[0])

        assert result.success
        assert result.namespace["summary"] == "Said 'Hello' 3 times"

    def test_input_override(self, with_inputs_path):
        df = parse_file(with_inputs_path)
        engine = ReactiveEngine()
        result = engine.execute_notebook(
            df.project.notebooks[0],
            input_variables={"greeting": "Hi", "count": 2},
        )

        assert result.success
        assert result.namespace["summary"] == "Said 'Hi' 2 times"

    def test_error_handling(self, with_error_path):
        df = parse_file(with_error_path)
        engine = ReactiveEngine()
        result = engine.execute_notebook(
            df.project.notebooks[0],
            stop_on_error=True,
        )

        assert not result.success
        # First block should succeed, second should fail
        assert result.block_results[0].success
        assert not result.block_results[1].success
        # Third block should not have run
        assert len(result.block_results) == 2

    def test_rich_display(self):
        """Test that objects with _repr_html_ produce rich output."""
        from deepnote_runtime.models import Block, BlockType, Notebook

        nb = Notebook(
            id="test",
            name="Test",
            blocks=[
                Block(
                    id="b1",
                    type=BlockType.CODE,
                    content="""
class RichTable:
    def _repr_html_(self):
        return '<table><tr><td>Rich!</td></tr></table>'
    def __repr__(self):
        return 'RichTable()'

RichTable()
""",
                    sorting_key="a0",
                ),
            ],
        )

        engine = ReactiveEngine()
        result = engine.execute_notebook(nb)

        assert result.success
        outputs = result.block_results[0].outputs
        result_outputs = [o for o in outputs if o.output_type == "execute_result"]
        assert len(result_outputs) == 1
        assert "text/html" in result_outputs[0].data
        assert "<table>" in result_outputs[0].data["text/html"]

    def test_display_function(self):
        """Test that display() works within code blocks."""
        from deepnote_runtime.models import Block, BlockType, Notebook

        nb = Notebook(
            id="test",
            name="Test",
            blocks=[
                Block(
                    id="b1",
                    type=BlockType.CODE,
                    content='display("first")\ndisplay("second")\n"result"',
                    sorting_key="a0",
                ),
            ],
        )

        engine = ReactiveEngine()
        result = engine.execute_notebook(nb)

        assert result.success
        outputs = result.block_results[0].outputs
        display_outputs = [o for o in outputs if o.output_type == "display_data"]
        result_outputs = [o for o in outputs if o.output_type == "execute_result"]
        assert len(display_outputs) == 2
        assert len(result_outputs) == 1

    def test_reactive_re_execution(self, with_inputs_path):
        """Test that changing an input triggers re-execution of dependent blocks."""
        df = parse_file(with_inputs_path)
        nb = df.project.notebooks[0]
        engine = ReactiveEngine()

        # Initial execution
        result = engine.execute_notebook(nb)
        assert result.success
        assert result.namespace["summary"] == "Said 'Hello' 3 times"

        # Change input variable
        engine._namespace["greeting"] = "Yo"
        re_result = engine.re_execute({"greeting"}, nb)

        # Both code blocks should re-execute (both read 'greeting')
        re_executed_ids = {r.block_id for r in re_result.block_results}
        assert "block-use-inputs" in re_executed_ids
        assert "block-summary" in re_executed_ids
        assert engine._namespace["summary"] == "Said 'Yo' 3 times"

    def test_snapshot_roundtrip(self, hello_world_path, tmp_path):
        """Test execute -> snapshot -> parse snapshot."""
        from deepnote_runtime.snapshot import write_snapshot, snapshot_path_for

        df = parse_file(hello_world_path)
        engine = ReactiveEngine()
        engine.execute_notebook(df.project.notebooks[0])

        # Write snapshot
        snap_path = tmp_path / "test.snapshot.deepnote"
        write_snapshot(df, snap_path)

        # Parse snapshot back (it's a valid .deepnote file with outputs)
        # We need to rename it since parser checks extension
        from deepnote_runtime.parser import parse_string
        snap_content = snap_path.read_text()
        snap_df = parse_string(snap_content)

        assert snap_df.version == "1.0.0"
        block = snap_df.project.notebooks[0].blocks[0]
        assert len(block.outputs) > 0
        assert block.outputs[0].output_type == "stream"

    def test_code_cache_works(self):
        """Test that code cache prevents recompilation."""
        from deepnote_runtime.models import Block, BlockType, Notebook

        nb = Notebook(
            id="test",
            name="Test",
            blocks=[
                Block(id="b1", type=BlockType.CODE, content="x = 1", sorting_key="a0"),
            ],
        )

        engine = ReactiveEngine()
        engine.execute_notebook(nb)

        # Cache should have at least one entry
        assert len(engine.code_cache) >= 1

    def test_shim_available_in_code(self):
        """Test that get_ipython() is available inside executed code."""
        from deepnote_runtime.models import Block, BlockType, Notebook

        nb = Notebook(
            id="test",
            name="Test",
            blocks=[
                Block(
                    id="b1",
                    type=BlockType.CODE,
                    content="shell = get_ipython()\nshell_name = shell.__class__.__name__",
                    sorting_key="a0",
                ),
            ],
        )

        engine = ReactiveEngine()
        result = engine.execute_notebook(nb)

        assert result.success
        assert result.namespace["shell_name"] == "ZMQInteractiveShell"
