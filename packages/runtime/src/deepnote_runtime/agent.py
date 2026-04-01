"""Agent block execution — runs LLM + code execution in-process.

Eliminates IPC round-trips by calling the LLM from Python and executing
generated code directly via compiler.execute() in the shared namespace.

Protocol:
    - Streams events to TypeScript via send_fn (fd3)
    - Receives MCP callback responses via receive_fn (stdin)
    - Code execution is in-process (no IPC)
"""

from __future__ import annotations

import json
import uuid
from typing import Any, Callable

from deepnote_runtime.compiler import CodeCache, CompileError, execute
from deepnote_runtime.output import OutputCapture, capture_output


def generate_sorting_key(index: int) -> str:
    """Generate a sorting key matching TypeScript's format."""
    return str(index).zfill(6)


def generate_block_id() -> str:
    """Generate a block ID matching TypeScript's format (UUID without hyphens)."""
    return uuid.uuid4().hex


class AgentRunner:
    """Runs an agent loop: calls LLM, executes code in-process, streams events.

    Args:
        namespace: Shared Python namespace for code execution.
        execution_count: Current execution count (incremented per code block).
        send_fn: Sends a protocol message dict to TypeScript (fd3).
        receive_fn: Reads a protocol message dict from TypeScript (stdin).
        code_cache: Optional code cache for compiled bytecode.
    """

    def __init__(
        self,
        namespace: dict[str, Any],
        execution_count: int,
        send_fn: Callable[[dict[str, Any]], None],
        receive_fn: Callable[[], dict[str, Any]],
        code_cache: CodeCache | None = None,
    ) -> None:
        self._namespace = namespace
        self._execution_count = execution_count
        self._send = send_fn
        self._receive = receive_fn
        self._code_cache = code_cache or CodeCache()
        self._added_blocks: list[dict[str, Any]] = []
        self._block_outputs: list[dict[str, Any]] = []

    @property
    def execution_count(self) -> int:
        return self._execution_count

    def run(self, config: dict[str, Any]) -> dict[str, Any]:
        """Run the agent loop.

        Args:
            config: Dict with keys:
                - prompt: User prompt text
                - model: Model name (e.g. "gpt-5")
                - api_key: OpenAI API key
                - base_url: Optional base URL for OpenAI-compatible providers
                - max_turns: Maximum number of LLM turns (default 10)
                - system_prompt: System prompt with notebook context
                - mcp_tools: Optional list of MCP tool definitions
                - request_id: Protocol request ID
                - insert_index: Index to insert new blocks at

        Returns:
            Dict with: final_output, added_block_ids, block_outputs, execution_count
        """
        try:
            import openai
        except ImportError:
            raise ImportError(
                "The 'openai' package is required for agent blocks. "
                "Install it with: pip install openai"
            )

        client = openai.OpenAI(
            api_key=config["api_key"],
            base_url=config.get("base_url"),
        )

        model = config["model"]
        max_turns = config.get("max_turns", 10)
        system_prompt = config["system_prompt"]
        prompt = config["prompt"]
        request_id = config.get("request_id", "agent")
        insert_index = config.get("insert_index", 0)

        tools = self._build_tools(config.get("mcp_tools"))

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]

        final_output = ""
        content = ""

        for _turn in range(max_turns):
            content, tool_calls = self._call_llm(
                client, model, messages, tools, request_id
            )

            if not tool_calls:
                final_output = content
                break

            # Build assistant message with tool calls
            assistant_msg: dict[str, Any] = {"role": "assistant"}
            if content:
                assistant_msg["content"] = content
            assistant_msg["tool_calls"] = [
                {
                    "id": tc["id"],
                    "type": "function",
                    "function": {
                        "name": tc["name"],
                        "arguments": tc["arguments"],
                    },
                }
                for tc in tool_calls
            ]
            messages.append(assistant_msg)

            # Execute tool calls
            for tc in tool_calls:
                tool_name = tc["name"]
                try:
                    arguments = json.loads(tc["arguments"])
                except json.JSONDecodeError:
                    arguments = {}

                self._send_event(request_id, "tool_called", {"tool_name": tool_name})

                result = self._execute_tool(
                    tool_name, arguments, request_id, insert_index
                )
                if tool_name in ("add_code_block", "add_markdown_block"):
                    insert_index += 1

                self._send_event(
                    request_id,
                    "tool_output",
                    {"tool_name": tool_name, "output": result},
                )

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": result,
                    }
                )
        else:
            # Max turns reached
            final_output = content or "(Agent reached maximum turns)"

        return {
            "final_output": final_output,
            "added_block_ids": [b["block_id"] for b in self._added_blocks],
            "block_outputs": self._block_outputs,
            "execution_count": self._execution_count,
        }

    def _call_llm(
        self,
        client: Any,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        request_id: str,
    ) -> tuple[str, list[dict[str, Any]]]:
        """Call the LLM with streaming, accumulate content and tool calls.

        Returns:
            (content_text, tool_calls_list)
        """
        import openai as openai_mod

        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": True,
        }
        if tools:
            kwargs["tools"] = tools

        stream = client.chat.completions.create(**kwargs)

        content_parts: list[str] = []
        tool_calls_map: dict[int, dict[str, Any]] = {}

        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta

            # Text content
            if delta.content:
                content_parts.append(delta.content)
                self._send_event(request_id, "text_delta", {"text": delta.content})

            # Tool calls (accumulated across chunks)
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in tool_calls_map:
                        tool_calls_map[idx] = {
                            "id": "",
                            "name": "",
                            "arguments": "",
                        }
                    if tc.id:
                        tool_calls_map[idx]["id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            tool_calls_map[idx]["name"] = tc.function.name
                        if tc.function.arguments:
                            tool_calls_map[idx]["arguments"] += tc.function.arguments

        content = "".join(content_parts)
        tool_calls = [tool_calls_map[i] for i in sorted(tool_calls_map.keys())]
        return content, tool_calls

    def _build_tools(
        self, mcp_tools: list[dict[str, Any]] | None = None
    ) -> list[dict[str, Any]]:
        """Build OpenAI-format tool definitions."""
        tools: list[dict[str, Any]] = [
            {
                "type": "function",
                "function": {
                    "name": "add_code_block",
                    "description": (
                        "Add a Python code block to the notebook and execute it. "
                        "Returns stdout, stderr, and execution results."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "code": {
                                "type": "string",
                                "description": "Python code to execute",
                            },
                        },
                        "required": ["code"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "add_markdown_block",
                    "description": (
                        "Add a markdown block to the notebook for explanations, "
                        "section headers, or documentation."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "content": {
                                "type": "string",
                                "description": "Markdown content",
                            },
                        },
                        "required": ["content"],
                    },
                },
            },
        ]

        if mcp_tools:
            for mt in mcp_tools:
                tools.append(
                    {
                        "type": "function",
                        "function": {
                            "name": mt["name"],
                            "description": mt.get("description", ""),
                            "parameters": mt.get(
                                "input_schema", mt.get("inputSchema", {})
                            ),
                        },
                    }
                )

        return tools

    def _execute_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        request_id: str,
        insert_index: int,
    ) -> str:
        """Execute a tool call and return the result string."""
        if tool_name == "add_code_block":
            return self._execute_code_block(
                arguments.get("code", ""), request_id, insert_index
            )
        elif tool_name == "add_markdown_block":
            return self._add_markdown_block(
                arguments.get("content", ""), request_id, insert_index
            )
        else:
            return self._call_mcp_tool(tool_name, arguments, request_id)

    def _execute_code_block(
        self, code: str, request_id: str, insert_index: int
    ) -> str:
        """Execute a code block in the shared namespace. No IPC — direct exec()."""
        self._execution_count += 1
        count = self._execution_count

        block_id = generate_block_id()

        capture = OutputCapture()
        success = True

        with capture_output(capture):
            self._namespace["display"] = capture.display_fn
            try:
                result = execute(
                    code,
                    self._namespace,
                    filename=f"<agent:{block_id[:8]}>",
                    code_cache=self._code_cache,
                )
                capture.set_result(result)
            except CompileError as e:
                capture.set_error(e)
                success = False
            except Exception as e:
                capture.set_error(e)
                success = False

        outputs = capture.collect_outputs(execution_count=count)
        output_dicts = [o.to_dict() for o in outputs]

        block_info: dict[str, Any] = {
            "block_id": block_id,
            "block_type": "code",
            "content": code,
            "sorting_key": generate_sorting_key(insert_index),
            "insert_index": insert_index,
            "outputs": output_dicts,
            "execution_count": count,
            "success": success,
        }

        self._added_blocks.append(block_info)
        self._block_outputs.append(
            {
                "block_id": block_id,
                "outputs": output_dicts,
                "execution_count": count,
            }
        )

        # Notify TypeScript about the new block
        self._send(
            {
                "id": request_id,
                "type": "agent_block_added",
                "block": block_info,
            }
        )

        # Build output text for the LLM
        output_text = _outputs_to_text(outputs) or "(no output)"
        if success:
            return f"Output:\n{output_text}"
        else:
            return f"Execution failed:\n{output_text}"

    def _add_markdown_block(
        self, content: str, request_id: str, insert_index: int
    ) -> str:
        """Add a markdown block to the notebook."""
        block_id = generate_block_id()

        block_info: dict[str, Any] = {
            "block_id": block_id,
            "block_type": "markdown",
            "content": content,
            "sorting_key": generate_sorting_key(insert_index),
            "insert_index": insert_index,
        }

        self._added_blocks.append(block_info)

        self._send(
            {
                "id": request_id,
                "type": "agent_block_added",
                "block": block_info,
            }
        )

        return "Markdown block added."

    def _call_mcp_tool(
        self, tool_name: str, arguments: dict[str, Any], request_id: str
    ) -> str:
        """Call an MCP tool by sending a callback request to TypeScript."""
        callback_id = uuid.uuid4().hex

        self._send(
            {
                "id": request_id,
                "type": "mcp_call_request",
                "callback_id": callback_id,
                "tool_name": tool_name,
                "arguments": arguments,
            }
        )

        # Block until TypeScript responds with the MCP result
        response = self._receive()

        if (
            response.get("type") == "mcp_call_response"
            and response.get("callback_id") == callback_id
        ):
            return response.get("result", "")
        else:
            return f"MCP callback error: unexpected response"

    def _send_event(
        self, request_id: str, event_type: str, data: dict[str, Any]
    ) -> None:
        """Stream an agent event to TypeScript."""
        self._send(
            {
                "id": request_id,
                "type": "agent_event",
                "event": event_type,
                "data": data,
            }
        )


def _outputs_to_text(outputs: list[Any]) -> str:
    """Convert BlockOutput objects to text for LLM consumption.

    Matches the TypeScript extractOutputsText behavior.
    """
    parts: list[str] = []
    for o in outputs:
        if o.output_type == "stream":
            if o.text:
                parts.append(o.text)
        elif o.output_type in ("execute_result", "display_data"):
            if o.data:
                if "text/plain" in o.data:
                    parts.append(str(o.data["text/plain"]))
                elif "text/html" in o.data:
                    parts.append("[HTML output]")
                elif "image/png" in o.data or "image/jpeg" in o.data:
                    parts.append("[Image output]")
        elif o.output_type == "error":
            ename = o.ename or "Error"
            evalue = o.evalue or ""
            parts.append(f"Error: {ename}: {evalue}")
            if o.traceback:
                for line in o.traceback:
                    parts.append(line)
    return "".join(parts)
