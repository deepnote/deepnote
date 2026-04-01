"""Reactive execution engine for .deepnote notebooks.

Executes blocks in dependency order. When input variables change,
determines which blocks need re-execution and runs only those.
"""

from __future__ import annotations

import time
import warnings
from dataclasses import dataclass, field
from typing import Any

from deepnote_runtime.compiler import CodeCache, CompileError, execute
from deepnote_runtime.dependency import (
    BlockAnalysis,
    DependencyGraph,
    analyze_block,
)
from deepnote_runtime.models import Block, BlockOutput, BlockType, EXECUTABLE_BLOCK_TYPES, Notebook
from deepnote_runtime.namespace import create_namespace
from deepnote_runtime.output import OutputCapture, capture_output
from deepnote_runtime.sql import execute_sql_block


@dataclass
class BlockResult:
    """Result of executing a single block."""

    block_id: str
    outputs: list[BlockOutput]
    execution_count: int
    duration_ms: float
    success: bool
    variables_written: set[str] = field(default_factory=set)


@dataclass
class ExecutionResult:
    """Result of executing a notebook."""

    block_results: list[BlockResult]
    namespace: dict[str, Any]
    dependency_graph: DependencyGraph

    @property
    def success(self) -> bool:
        return all(r.success for r in self.block_results)

    @property
    def failed_blocks(self) -> list[BlockResult]:
        return [r for r in self.block_results if not r.success]


class ReactiveEngine:
    """Executes notebook blocks with dependency tracking and reactive re-execution."""

    def __init__(self) -> None:
        self.code_cache = CodeCache()
        self._execution_count = 0
        self._namespace: dict[str, Any] = {}
        self._dep_graph = DependencyGraph()
        self._block_results: dict[str, BlockResult] = {}

    def execute_notebook(
        self,
        notebook: Notebook,
        input_variables: dict[str, Any] | None = None,
        stop_on_error: bool = True,
    ) -> ExecutionResult:
        """Execute all blocks in a notebook in dependency order.

        Args:
            notebook: The notebook to execute.
            input_variables: Variables from input blocks and CLI overrides.
            stop_on_error: If True, stop execution on first error.
        """
        # Collect input variables from input blocks
        all_inputs = {}
        for block in notebook.input_blocks:
            var_name = block.variable_name
            if var_name is not None:
                all_inputs[var_name] = block.variable_value

        # CLI overrides take precedence
        if input_variables:
            all_inputs.update(input_variables)

        # Create display collector for this execution
        from deepnote_runtime.output import DisplayCollector

        display_collector = DisplayCollector()

        # Create namespace
        self._namespace = create_namespace(
            input_variables=all_inputs,
            display_fn=display_collector.display,
        )

        # Analyze dependencies for all code blocks
        self._dep_graph = DependencyGraph()
        sorted_blocks = notebook.sorted_blocks
        code_blocks = [b for b in sorted_blocks if b.is_executable]

        for block in code_blocks:
            if block.type == BlockType.SQL:
                # SQL blocks write the variable_name, content is SQL not Python
                var_name = block.metadata.get("deepnote_variable_name")
                analysis = BlockAnalysis(
                    block_id=block.id,
                    writes={var_name} if var_name else set(),
                )
            elif block.type == BlockType.BUTTON:
                var_name = block.metadata.get("deepnote_variable_name")
                analysis = BlockAnalysis(
                    block_id=block.id,
                    writes={var_name} if var_name else set(),
                )
            elif block.type == BlockType.VISUALIZATION:
                # Visualization reads a DataFrame variable
                var_name = block.metadata.get("deepnote_variable_name")
                analysis = BlockAnalysis(
                    block_id=block.id,
                    reads={var_name} if var_name else set(),
                )
            else:
                # Code blocks — analyze Python AST
                analysis = analyze_block(block.id, block.content)

            self._dep_graph.add(analysis)

            for warning in analysis.dynamic_warnings:
                warnings.warn(warning, stacklevel=2)

        # Input blocks also "write" variables
        for block in notebook.input_blocks:
            var_name = block.variable_name
            if var_name:
                input_analysis = BlockAnalysis(
                    block_id=block.id,
                    writes={var_name},
                )
                self._dep_graph.add(input_analysis)

        # Determine execution order (preserve sorting_key as tiebreaker)
        all_block_ids = {b.id for b in code_blocks}
        block_order = {b.id: i for i, b in enumerate(code_blocks)}
        execution_order = self._dep_graph.topological_sort(all_block_ids, block_order=block_order)

        # Map block IDs to blocks for quick lookup
        block_map = {b.id: b for b in code_blocks}

        # Execute blocks in order
        results = []
        for block_id in execution_order:
            block = block_map.get(block_id)
            if block is None:
                continue

            result = self._execute_block(block)
            results.append(result)
            self._block_results[block_id] = result

            if not result.success and stop_on_error:
                break

        return ExecutionResult(
            block_results=results,
            namespace=self._namespace,
            dependency_graph=self._dep_graph,
        )

    def re_execute(
        self,
        changed_variables: set[str],
        notebook: Notebook,
        stop_on_error: bool = True,
    ) -> ExecutionResult:
        """Re-execute only blocks affected by changed variables.

        Args:
            changed_variables: Set of variable names that changed.
            notebook: The notebook (for block lookup).
            stop_on_error: If True, stop on first error.
        """
        # Update changed variables in namespace
        dirty_block_ids = self._dep_graph.get_dirty_blocks(changed_variables)
        code_blocks = [b for b in notebook.sorted_blocks if b.is_executable]
        block_map = {b.id: b for b in code_blocks}

        # Only re-execute dirty blocks that are actual code blocks
        dirty_code_ids = dirty_block_ids & set(block_map.keys())
        execution_order = self._dep_graph.topological_sort(dirty_code_ids)

        results = []
        for block_id in execution_order:
            block = block_map.get(block_id)
            if block is None:
                continue

            result = self._execute_block(block)
            results.append(result)
            self._block_results[block_id] = result

            if not result.success and stop_on_error:
                break

        return ExecutionResult(
            block_results=results,
            namespace=self._namespace,
            dependency_graph=self._dep_graph,
        )

    def _execute_block(self, block: Block) -> BlockResult:
        """Execute a single block, dispatching by type."""
        self._execution_count += 1
        count = self._execution_count

        capture = OutputCapture()
        start = time.perf_counter()
        success = True

        keys_before = set(self._namespace.keys())

        with capture_output(capture):
            self._namespace["display"] = capture.display_fn
            try:
                if block.type == BlockType.SQL:
                    result = self._execute_sql_block(block)
                    capture.set_result(result)
                elif block.type == BlockType.BUTTON:
                    result = self._execute_button_block(block)
                    capture.set_result(result)
                elif block.type == BlockType.BIG_NUMBER:
                    result = self._execute_big_number_block(block)
                    capture.set_result(result)
                elif block.type == BlockType.VISUALIZATION:
                    result = self._execute_visualization_block(block)
                    capture.set_result(result)
                elif block.type == BlockType.AGENT:
                    result = self._execute_agent_block(block)
                    capture.set_result(result)
                else:
                    # Code blocks (default)
                    result = execute(
                        block.content,
                        self._namespace,
                        filename=f"<block:{block.id}>",
                        code_cache=self.code_cache,
                    )
                    capture.set_result(result)
            except CompileError as e:
                capture.set_error(e)
                success = False
            except Exception as e:
                capture.set_error(e)
                success = False

        duration_ms = (time.perf_counter() - start) * 1000

        keys_after = set(self._namespace.keys())
        variables_written = keys_after - keys_before

        outputs = capture.collect_outputs(execution_count=count)

        block.outputs = outputs
        block.execution_count = count

        return BlockResult(
            block_id=block.id,
            outputs=outputs,
            execution_count=count,
            duration_ms=duration_ms,
            success=success,
            variables_written=variables_written,
        )

    def _execute_sql_block(self, block: Block) -> Any:
        """Execute a SQL block via SQLAlchemy."""
        integration_id = block.metadata.get("sql_integration_id", "")
        variable_name = block.metadata.get("deepnote_variable_name")

        df = execute_sql_block(
            query=block.content,
            integration_id=integration_id,
            namespace=self._namespace,
            variable_name=variable_name,
        )

        # Print the DataFrame so it shows as output
        if df is not None and variable_name:
            return df
        return None

    def _execute_button_block(self, block: Block) -> Any:
        """Execute a button block — assigns a boolean variable."""
        variable_name = block.metadata.get("deepnote_variable_name")
        if variable_name:
            # In CLI/headless mode, button is always False (not clicked)
            self._namespace[variable_name] = False
        return None

    def _execute_big_number_block(self, block: Block) -> Any:
        """Execute a big-number block — renders Jinja2 templates."""
        import json as json_mod

        title_template = block.metadata.get("deepnote_big_number_title", "")
        value_template = block.metadata.get("deepnote_big_number_value", "")

        try:
            from jinja2 import Environment, meta

            env = Environment()

            def render(template: str) -> str:
                parsed = env.parse(template)
                required = meta.find_undeclared_variables(parsed)
                context = {v: self._namespace.get(v) for v in required}
                return env.from_string(template).render(context)

            rendered_title = render(title_template)
            rendered_value = render(value_template)
        except ImportError:
            rendered_title = title_template
            rendered_value = value_template

        return json_mod.dumps({"title": rendered_title, "value": rendered_value})

    def _execute_visualization_block(self, block: Block) -> Any:
        """Execute a visualization block — creates a DeepnoteChart."""
        from deepnote_runtime.chart import execute_visualization_block

        return execute_visualization_block(block.metadata, self._namespace)

    def _execute_agent_block(self, block: Block) -> Any:
        """Execute an agent block — calls LLM and runs code in-process.

        Requires the 'openai' package (pip install deepnote-runtime[agent]).
        """
        import os

        from deepnote_runtime.agent import AgentRunner, _outputs_to_text

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "OPENAI_API_KEY environment variable is required for agent blocks."
            )

        model_name = block.metadata.get("deepnote_agent_model", "auto")
        if model_name == "auto":
            model_name = os.environ.get("OPENAI_MODEL", "gpt-5")

        # Build notebook context for the system prompt
        context_lines = []
        for b in block._notebook_blocks if hasattr(block, "_notebook_blocks") else []:
            context_lines.append(f"## Block [{b.type.value}] (id: {b.id[:8]})")
            if b.content:
                context_lines.append("```")
                context_lines.append(b.content)
                context_lines.append("```")
            if b.outputs:
                context_lines.append("### Output:")
                context_lines.append(_outputs_to_text(b.outputs))
            context_lines.append("")
        notebook_context = "\n".join(context_lines) or "(empty notebook)"

        system_prompt = (
            "You are a data science assistant working inside a Deepnote notebook.\n\n"
            f"## Current notebook state\n\n{notebook_context}\n\n"
            "## Instructions\n\n"
            "- Use add_code_block to write and execute Python code. You will see the output.\n"
            "- Use add_markdown_block to add explanations, section headers, or documentation.\n"
            "- Analyze data step by step: load, explore, transform, visualize, summarize.\n"
            "- If a code block errors, read the error and try a different approach.\n"
            "- When you are done, provide a brief summary of what you did and found.\n"
            "- Be concise in markdown blocks. Prefer code that shows results over long explanations."
        )

        # Silent send/receive for standalone execution (no IPC)
        def noop_send(msg: dict) -> None:
            pass

        def noop_receive() -> dict:
            return {}

        runner = AgentRunner(
            namespace=self._namespace,
            execution_count=self._execution_count,
            send_fn=noop_send,
            receive_fn=noop_receive,
            code_cache=self.code_cache,
        )

        result = runner.run({
            "prompt": block.content,
            "model": model_name,
            "api_key": api_key,
            "base_url": os.environ.get("OPENAI_BASE_URL"),
            "max_turns": 10,
            "system_prompt": system_prompt,
            "insert_index": 0,
        })

        self._execution_count = runner.execution_count

        return result.get("final_output", "")
