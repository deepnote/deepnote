"""Tests for output capture."""

import sys

from deepnote_runtime.output import (
    DisplayCollector,
    OutputCapture,
    build_mime_bundle,
    capture_output,
)


class TestBuildMimeBundle:
    def test_plain_object(self):
        bundle = build_mime_bundle(42)
        assert bundle["text/plain"] == "42"

    def test_string(self):
        bundle = build_mime_bundle("hello")
        assert bundle["text/plain"] == "'hello'"

    def test_repr_html(self):
        class HtmlObj:
            def _repr_html_(self):
                return "<b>bold</b>"
            def __repr__(self):
                return "HtmlObj"

        bundle = build_mime_bundle(HtmlObj())
        assert bundle["text/html"] == "<b>bold</b>"
        assert bundle["text/plain"] == "HtmlObj"

    def test_repr_mimebundle(self):
        class MimeBundleObj:
            def _repr_mimebundle_(self):
                return {"text/html": "<p>hi</p>", "text/plain": "hi"}

        bundle = build_mime_bundle(MimeBundleObj())
        assert bundle["text/html"] == "<p>hi</p>"
        assert bundle["text/plain"] == "hi"

    def test_repr_mimebundle_tuple(self):
        class MimeBundleObj:
            def _repr_mimebundle_(self):
                return ({"text/html": "<p>hi</p>"}, {"text/html": {"isolated": True}})

        bundle = build_mime_bundle(MimeBundleObj())
        assert bundle["text/html"] == "<p>hi</p>"

    def test_repr_method_exception_ignored(self):
        class BadRepr:
            def _repr_html_(self):
                raise RuntimeError("broken")
            def __repr__(self):
                return "BadRepr"

        bundle = build_mime_bundle(BadRepr())
        assert "text/html" not in bundle
        assert bundle["text/plain"] == "BadRepr"

    def test_repr_returns_none_ignored(self):
        class NoneRepr:
            def _repr_html_(self):
                return None
            def __repr__(self):
                return "NoneRepr"

        bundle = build_mime_bundle(NoneRepr())
        assert "text/html" not in bundle

    def test_multiple_repr_methods(self):
        class MultiRepr:
            def _repr_html_(self):
                return "<b>html</b>"
            def _repr_markdown_(self):
                return "**markdown**"
            def __repr__(self):
                return "multi"

        bundle = build_mime_bundle(MultiRepr())
        assert bundle["text/html"] == "<b>html</b>"
        assert bundle["text/markdown"] == "**markdown**"
        assert bundle["text/plain"] == "multi"


class TestOutputCapture:
    def test_capture_stdout(self):
        capture = OutputCapture()
        with capture_output(capture):
            print("hello")

        outputs = capture.collect_outputs()
        assert len(outputs) == 1
        assert outputs[0].output_type == "stream"
        assert outputs[0].name == "stdout"
        assert outputs[0].text == "hello\n"

    def test_capture_stderr(self):
        capture = OutputCapture()
        with capture_output(capture):
            print("error!", file=sys.stderr)

        outputs = capture.collect_outputs()
        assert len(outputs) == 1
        assert outputs[0].output_type == "stream"
        assert outputs[0].name == "stderr"
        assert outputs[0].text == "error!\n"

    def test_capture_both_streams(self):
        capture = OutputCapture()
        with capture_output(capture):
            print("out")
            print("err", file=sys.stderr)

        outputs = capture.collect_outputs()
        assert len(outputs) == 2
        stdout = [o for o in outputs if o.name == "stdout"][0]
        stderr = [o for o in outputs if o.name == "stderr"][0]
        assert stdout.text == "out\n"
        assert stderr.text == "err\n"

    def test_capture_result(self):
        capture = OutputCapture()
        capture.set_result(42)
        outputs = capture.collect_outputs(execution_count=1)

        result_outputs = [o for o in outputs if o.output_type == "execute_result"]
        assert len(result_outputs) == 1
        assert result_outputs[0].data["text/plain"] == "42"
        assert result_outputs[0].execution_count == 1

    def test_capture_error(self):
        capture = OutputCapture()
        try:
            1 / 0
        except ZeroDivisionError as e:
            capture.set_error(e)

        outputs = capture.collect_outputs()
        error_outputs = [o for o in outputs if o.output_type == "error"]
        assert len(error_outputs) == 1
        assert error_outputs[0].ename == "ZeroDivisionError"
        assert "division by zero" in error_outputs[0].evalue

    def test_error_takes_precedence_over_result(self):
        """If both error and result are set, only error appears."""
        capture = OutputCapture()
        capture.set_result(42)
        capture.set_error(ValueError("bad"))

        outputs = capture.collect_outputs()
        types = [o.output_type for o in outputs]
        assert "error" in types
        assert "execute_result" not in types

    def test_no_output(self):
        capture = OutputCapture()
        outputs = capture.collect_outputs()
        assert outputs == []

    def test_streams_restored_after_capture(self):
        original_stdout = sys.stdout
        original_stderr = sys.stderr
        capture = OutputCapture()

        with capture_output(capture):
            pass

        assert sys.stdout is original_stdout
        assert sys.stderr is original_stderr

    def test_streams_restored_on_exception(self):
        original_stdout = sys.stdout
        capture = OutputCapture()

        try:
            with capture_output(capture):
                raise RuntimeError("boom")
        except RuntimeError:
            pass

        assert sys.stdout is original_stdout


class TestDisplayCollector:
    def test_display(self):
        collector = DisplayCollector()
        collector.display(42)

        assert len(collector.outputs) == 1
        assert collector.outputs[0].output_type == "display_data"
        assert collector.outputs[0].data["text/plain"] == "42"

    def test_display_rich_object(self):
        class RichObj:
            def _repr_html_(self):
                return "<p>rich</p>"

        collector = DisplayCollector()
        collector.display(RichObj())

        assert collector.outputs[0].data["text/html"] == "<p>rich</p>"

    def test_clear(self):
        collector = DisplayCollector()
        collector.display(1)
        collector.display(2)
        assert len(collector.outputs) == 2
        collector.clear()
        assert len(collector.outputs) == 0

    def test_display_in_capture(self):
        capture = OutputCapture()
        with capture_output(capture):
            capture.display_fn({"key": "value"})

        outputs = capture.collect_outputs()
        display_outputs = [o for o in outputs if o.output_type == "display_data"]
        assert len(display_outputs) == 1
