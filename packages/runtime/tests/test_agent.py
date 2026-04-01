"""Tests for agent block execution."""

import json
from unittest.mock import MagicMock, patch

import pytest

from deepnote_runtime.agent import AgentRunner, _outputs_to_text, generate_block_id, generate_sorting_key
from deepnote_runtime.compiler import CodeCache
from deepnote_runtime.models import BlockOutput
from deepnote_runtime.namespace import create_namespace


class TestHelpers:
    def test_generate_sorting_key(self):
        assert generate_sorting_key(0) == "000000"
        assert generate_sorting_key(1) == "000001"
        assert generate_sorting_key(42) == "000042"
        assert generate_sorting_key(999999) == "999999"

    def test_generate_block_id(self):
        bid = generate_block_id()
        assert len(bid) == 32
        assert "-" not in bid
        # Should be unique
        assert generate_block_id() != bid

    def test_outputs_to_text_stream(self):
        outputs = [BlockOutput(output_type="stream", name="stdout", text="hello\n")]
        assert _outputs_to_text(outputs) == "hello\n"

    def test_outputs_to_text_execute_result(self):
        outputs = [
            BlockOutput(
                output_type="execute_result",
                data={"text/plain": "42"},
            )
        ]
        assert _outputs_to_text(outputs) == "42"

    def test_outputs_to_text_html_placeholder(self):
        outputs = [
            BlockOutput(
                output_type="display_data",
                data={"text/html": "<table>...</table>"},
            )
        ]
        assert _outputs_to_text(outputs) == "[HTML output]"

    def test_outputs_to_text_image_placeholder(self):
        outputs = [
            BlockOutput(
                output_type="display_data",
                data={"image/png": "base64data"},
            )
        ]
        assert _outputs_to_text(outputs) == "[Image output]"

    def test_outputs_to_text_error(self):
        outputs = [
            BlockOutput(
                output_type="error",
                ename="ZeroDivisionError",
                evalue="division by zero",
            )
        ]
        result = _outputs_to_text(outputs)
        assert "ZeroDivisionError" in result
        assert "division by zero" in result

    def test_outputs_to_text_empty(self):
        assert _outputs_to_text([]) == ""


class TestAgentRunnerCodeExecution:
    """Test the in-process code execution path."""

    def setup_method(self):
        self.sent_messages: list[dict] = []
        self.namespace = create_namespace()
        self.runner = AgentRunner(
            namespace=self.namespace,
            execution_count=0,
            send_fn=lambda msg: self.sent_messages.append(msg),
            receive_fn=lambda: {},
            code_cache=CodeCache(),
        )

    def test_execute_code_block_success(self):
        result = self.runner._execute_code_block("x = 42\nprint(x)", "req1", 0)
        assert "Output:" in result
        assert "42" in result
        assert self.namespace["x"] == 42
        assert self.runner.execution_count == 1

        # Should have sent block_added notification
        added = [m for m in self.sent_messages if m.get("type") == "agent_block_added"]
        assert len(added) == 1
        assert added[0]["block"]["block_type"] == "code"
        assert added[0]["block"]["success"] is True

    def test_execute_code_block_failure(self):
        result = self.runner._execute_code_block("1/0", "req1", 0)
        assert "Execution failed:" in result
        assert "ZeroDivisionError" in result

        added = [m for m in self.sent_messages if m.get("type") == "agent_block_added"]
        assert len(added) == 1
        assert added[0]["block"]["success"] is False

    def test_execute_code_block_compile_error(self):
        result = self.runner._execute_code_block("def", "req1", 0)
        assert "Execution failed:" in result

    def test_namespace_persistence(self):
        """Variables from one code block are available in the next."""
        self.runner._execute_code_block("x = 10", "req1", 0)
        result = self.runner._execute_code_block("y = x * 2\nprint(y)", "req1", 1)
        assert "20" in result
        assert self.namespace["y"] == 20

    def test_execution_count_increments(self):
        self.runner._execute_code_block("a = 1", "req1", 0)
        self.runner._execute_code_block("b = 2", "req1", 1)
        assert self.runner.execution_count == 2

    def test_add_markdown_block(self):
        result = self.runner._add_markdown_block("# Hello", "req1", 0)
        assert result == "Markdown block added."

        added = [m for m in self.sent_messages if m.get("type") == "agent_block_added"]
        assert len(added) == 1
        assert added[0]["block"]["block_type"] == "markdown"
        assert added[0]["block"]["content"] == "# Hello"

    def test_block_outputs_tracked(self):
        self.runner._execute_code_block("print('hi')", "req1", 0)
        assert len(self.runner._block_outputs) == 1
        assert self.runner._block_outputs[0]["outputs"][0]["output_type"] == "stream"


class TestAgentRunnerMcpCallback:
    """Test the MCP tool callback mechanism."""

    def test_mcp_callback(self):
        sent: list[dict] = []
        callback_response = {"type": "mcp_call_response", "callback_id": "", "result": "tool output"}

        def receive_fn():
            # Patch the callback_id from the sent request
            callback_response["callback_id"] = sent[-1]["callback_id"]
            return callback_response

        runner = AgentRunner(
            namespace=create_namespace(),
            execution_count=0,
            send_fn=lambda msg: sent.append(msg),
            receive_fn=receive_fn,
        )

        result = runner._call_mcp_tool("my_tool", {"key": "value"}, "req1")
        assert result == "tool output"

        # Should have sent mcp_call_request
        requests = [m for m in sent if m.get("type") == "mcp_call_request"]
        assert len(requests) == 1
        assert requests[0]["tool_name"] == "my_tool"
        assert requests[0]["arguments"] == {"key": "value"}


class TestAgentRunnerToolBuilding:
    def test_build_tools_default(self):
        runner = AgentRunner(
            namespace={}, execution_count=0,
            send_fn=lambda m: None, receive_fn=lambda: {},
        )
        tools = runner._build_tools()
        names = [t["function"]["name"] for t in tools]
        assert "add_code_block" in names
        assert "add_markdown_block" in names
        assert len(tools) == 2

    def test_build_tools_with_mcp(self):
        runner = AgentRunner(
            namespace={}, execution_count=0,
            send_fn=lambda m: None, receive_fn=lambda: {},
        )
        mcp_tools = [
            {"name": "search", "description": "Search docs", "inputSchema": {"type": "object"}},
        ]
        tools = runner._build_tools(mcp_tools)
        names = [t["function"]["name"] for t in tools]
        assert "search" in names
        assert len(tools) == 3


class TestAgentRunnerEvents:
    def test_send_event(self):
        sent: list[dict] = []
        runner = AgentRunner(
            namespace={}, execution_count=0,
            send_fn=lambda msg: sent.append(msg),
            receive_fn=lambda: {},
        )

        runner._send_event("req1", "text_delta", {"text": "hello"})
        assert len(sent) == 1
        assert sent[0]["type"] == "agent_event"
        assert sent[0]["event"] == "text_delta"
        assert sent[0]["data"]["text"] == "hello"


class TestAgentRunnerFullLoop:
    """Test the full agent loop with mocked OpenAI SDK."""

    @patch("openai.OpenAI")
    def test_simple_text_response(self, mock_openai_cls):
        """Agent produces text without tool calls."""
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client

        # Create a mock chunk with text content and no tool calls
        chunk = MagicMock()
        chunk.choices = [MagicMock()]
        chunk.choices[0].delta.content = "Analysis complete."
        chunk.choices[0].delta.tool_calls = None

        mock_client.chat.completions.create.return_value = iter([chunk])

        sent: list[dict] = []
        runner = AgentRunner(
            namespace=create_namespace(),
            execution_count=0,
            send_fn=lambda msg: sent.append(msg),
            receive_fn=lambda: {},
        )

        result = runner.run({
            "prompt": "Analyze the data",
            "model": "gpt-5",
            "api_key": "test-key",
            "system_prompt": "You are a test assistant",
            "max_turns": 10,
            "insert_index": 0,
        })

        assert result["final_output"] == "Analysis complete."
        assert result["added_block_ids"] == []

    @patch("openai.OpenAI")
    def test_tool_call_then_text(self, mock_openai_cls):
        """Agent makes a tool call, then produces final text."""
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client

        # Turn 1: tool call
        tc_chunk = MagicMock()
        tc_chunk.choices = [MagicMock()]
        tc_chunk.choices[0].delta.content = None
        tc_delta = MagicMock()
        tc_delta.index = 0
        tc_delta.id = "call_123"
        tc_delta.function = MagicMock()
        tc_delta.function.name = "add_code_block"
        tc_delta.function.arguments = json.dumps({"code": "x = 42\nprint(x)"})
        tc_chunk.choices[0].delta.tool_calls = [tc_delta]

        # Turn 2: text response
        text_chunk = MagicMock()
        text_chunk.choices = [MagicMock()]
        text_chunk.choices[0].delta.content = "Done."
        text_chunk.choices[0].delta.tool_calls = None

        mock_client.chat.completions.create.side_effect = [
            iter([tc_chunk]),
            iter([text_chunk]),
        ]

        sent: list[dict] = []
        ns = create_namespace()
        runner = AgentRunner(
            namespace=ns,
            execution_count=0,
            send_fn=lambda msg: sent.append(msg),
            receive_fn=lambda: {},
            code_cache=CodeCache(),
        )

        result = runner.run({
            "prompt": "Set x to 42",
            "model": "gpt-5",
            "api_key": "test-key",
            "system_prompt": "You are a test assistant",
            "max_turns": 10,
            "insert_index": 0,
        })

        assert result["final_output"] == "Done."
        assert len(result["added_block_ids"]) == 1
        assert ns["x"] == 42
        assert result["execution_count"] == 1

        # Check events were sent
        tool_called = [m for m in sent if m.get("type") == "agent_event" and m.get("event") == "tool_called"]
        assert len(tool_called) == 1
        assert tool_called[0]["data"]["tool_name"] == "add_code_block"

    @patch("openai.OpenAI")
    def test_max_turns_reached(self, mock_openai_cls):
        """Agent hits max turns limit."""
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client

        # Always return tool calls (agent never finishes)
        def make_tc_response():
            tc_chunk = MagicMock()
            tc_chunk.choices = [MagicMock()]
            tc_chunk.choices[0].delta.content = None
            tc_delta = MagicMock()
            tc_delta.index = 0
            tc_delta.id = f"call_{id(tc_chunk)}"
            tc_delta.function = MagicMock()
            tc_delta.function.name = "add_code_block"
            tc_delta.function.arguments = json.dumps({"code": "pass"})
            tc_chunk.choices[0].delta.tool_calls = [tc_delta]
            return iter([tc_chunk])

        mock_client.chat.completions.create.side_effect = [make_tc_response() for _ in range(3)]

        runner = AgentRunner(
            namespace=create_namespace(),
            execution_count=0,
            send_fn=lambda msg: None,
            receive_fn=lambda: {},
        )

        result = runner.run({
            "prompt": "Loop forever",
            "model": "gpt-5",
            "api_key": "test-key",
            "system_prompt": "Test",
            "max_turns": 3,
            "insert_index": 0,
        })

        assert "maximum turns" in result["final_output"]
        assert len(result["added_block_ids"]) == 3
