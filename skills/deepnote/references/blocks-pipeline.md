# Pipeline Notebooks

> Common block fields (`id`, `blockGroup`, `type`, `content`, `sortingKey`, `metadata`) are described in [SKILL.md](../SKILL.md).

A pipeline is a notebook marked `isPipeline: true` whose `notebook-function` blocks are its steps. Each step names an external notebook to run, the inputs to run it with, and the values it publishes as pipeline variables. The pipeline notebook is read as a manifest rather than executed: `@deepnote/pipelines` derives a dependency graph from variable flow, runs independent steps concurrently, and reports each one separately.

The encoding is the one deepnote.com stores for a notebook-function block. There is no templating and no expression syntax inside inputs — a value is either a reference to a variable by name, or a literal.

## Pipeline marker

| Field        | Type      | Description                                                                                     |
| ------------ | --------- | ----------------------------------------------------------------------------------------------- |
| `isPipeline` | `boolean` | Set on exactly one notebook in `project.notebooks`. Its notebook-function blocks are the steps. |

A file with no marked notebook, or with more than one, is rejected at plan time (a caller may name the notebook explicitly instead). Steps run in `sortingKey` order only where dependencies require it.

## Step block (`notebook-function`)

**Metadata fields:**

| Field                               | Type                            | Required | Description                                                                                                            |
| ----------------------------------- | ------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `function_notebook_id`              | `string \| null`                | yes      | Id of the notebook this step runs. `null` is a plan-time error.                                                        |
| `function_notebook_inputs`          | `Record<string, Input>`         | no       | Input-block name → what to pass (see below).                                                                           |
| `function_notebook_export_mappings` | `Record<string, ExportMapping>` | no       | Field in the notebook's last JSON output → pipeline variable it publishes.                                             |
| `function_notebook_run_if`          | `string`                        | no       | Condition; the step runs only when it holds. Evaluated per element on a fan-out.                                       |
| `function_notebook_for_each`        | `string`                        | no       | Name of a pipeline variable holding an array. The step runs once per element, concurrently.                            |
| `function_notebook_for_each_as`     | `string`                        | no       | Name each element is bound to (default `item`). Usable as an input `variable_name` and in `run_if`.                    |
| `function_notebook_allow_failure`   | `boolean`                       | no       | Return a failed run as a result instead of failing the pipeline (default `false`). Covers timeouts and API errors too. |
| `name`                              | `string`                        | no       | Display label; the block id is used when absent.                                                                       |

**Input** (each value in `function_notebook_inputs`):

| Field           | Type             | Description                                                                                                  |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `variable_name` | `string \| null` | A pipeline variable: another step's export, or this step's `for_each_as` element. Creates a dependency edge. |
| `custom_value`  | `any`            | A literal, passed as written. Used when `variable_name` is not set.                                          |
| `fallback`      | `Input`          | Used when `variable_name` refers to a variable whose producer was skipped or failed. May chain.              |

deepnote.com writes both `variable_name` and `custom_value` (one of them `null`); the variable wins when it is a non-empty string. A `variable_name` is a plain identifier — no dotted paths. Read a field in `run_if`, or export the field from the step that produces it.

**ExportMapping** (each value in `function_notebook_export_mappings`):

| Field           | Type             | Description                                                               |
| --------------- | ---------------- | ------------------------------------------------------------------------- |
| `enabled`       | `boolean`        | Disabled mappings publish nothing.                                        |
| `variable_name` | `string \| null` | The pipeline variable name. Each variable may come from exactly one step. |

Exports are read from the JSON object that ends the notebook's output, keyed by the mapping's key. The last block's output must _end_ with a JSON object; anything printed before it on earlier lines is ignored, so a summary `print` before the `json.dumps` is fine, and pretty-printed JSON spanning several lines parses. A later block that prints only prose is skipped. When nothing parses, the error quotes the last 200 characters the block printed. On a fan-out, each exported variable collects one value per element, in element order — an empty array when no element ran.

Deepnote input blocks accept strings, booleans and lists of strings (numbers are sent as strings), so a structure that has to cross into another notebook should be exported as a JSON string.

The runs API rejects arrays for text inputs, so a variable that holds a fan-out's collected list can only feed an `input-select` block with `deepnote_allow_multiple_values: true`. Passing it to an `input-text` block fails the step. In the consuming notebook:

```yaml
- type: input-select
  metadata:
    { deepnote_variable_name: regions, deepnote_allow_multiple_values: true }
```

with the step's input `regions: { variable_name: regions }` where `regions` is the fan-out's collected variable.

## Dependencies

Edges are derived, never declared: a step depends on every step whose variable it reads — in an input, in any `fallback` of that input, in `function_notebook_for_each`, or in `function_notebook_run_if`. The `for_each_as` element is bound by the step itself and is not a dependency.

## Conditions (`function_notebook_run_if`)

A small expression language, not JavaScript: variable paths (`quality.score`, `tags[0]`), literals (numbers, quoted strings, `true`, `false`, `null`), comparisons (`< <= > >= == !=`), `&& || !`, and parentheses. No calls, no assignment, and own-property lookups only. A malformed condition is a plan-time error.

Comparison rule: when both operands are numbers or numeric strings they compare numerically (`"6" == 6` is true, `"10" > "9"` is true); otherwise strictly (`"a" == 6` is false). `==` treats absent as `null`, so `recovered == null` asks whether a skipped step published anything.

## Skipping and failure

- A false `run_if` skips the step.
- A step whose input (after its `fallback` chain) refers to a variable that never arrived is skipped. So is a `for_each` over such a variable. This is how a skip propagates downstream, and what `fallback` interrupts.
- A fan-out over an empty array, or whose every element was gated off, is not skipped: it publishes empty arrays.
- A `for_each` over something that is not an array, or over more than 50 elements, is a run-time error naming the step.
- A failed run fails the pipeline unless `function_notebook_allow_failure` is `true`; then the failed result is returned, the step publishes nothing, and dependents fall back or are skipped. On a fan-out, exports collect from the elements that succeeded. `allow_failure` covers every way a step can fail — a notebook that finished with an error status, a poll that timed out, a transport or API error, a run that produced no snapshot — and the returned result's `status` (`timeout` when the runner stopped waiting, `error` for the rest, otherwise Deepnote's run status) and `error` say which. A timed-out run may still be executing in Deepnote; its `runId` is on the result.
- A run that finishes but whose exports cannot be read — no JSON object ends its output, or the object lacks an exported key — counts as a failed step. With `allow_failure` it is listed in `failed`, publishes nothing, and emits no further event; on a fan-out only the readable elements are collected. Without `allow_failure` it fails the pipeline with a step error naming the step.

When the pipeline fails, the run so far is not discarded. The error is a `PipelineStepError` (a step failed, or its exports could not be read) or a `PipelineRunError` (anything else the run threw, with the original error as `cause`), and both carry `partial`: the step results that finished in start order, the graph with each node's status, and `startedAt`, `finishedAt`, `durationMs`. The file runner also attaches `variables`, `skipped` and `failed` as they stood when the run stopped, so a caller can render every value that did arrive next to the step that stopped the run. A terminal step marked `allow_failure` therefore never fails the run: it resolves with every other variable present and the step in `failed`.

Plan-time errors (before anything runs): no or multiple `isPipeline` notebooks, a pipeline notebook with no steps, a step with `function_notebook_id: null`, a variable no step exports, two steps exporting one variable, a variable reference that is not a plain identifier, `for_each_as` without `for_each` or shadowing an export, a malformed condition, and a dependency cycle.

## Example

```yaml
project:
  notebooks:
    - id: pipeline
      name: Regional review
      isPipeline: true
      blocks:
        - id: load
          blockGroup: g-load
          sortingKey: a0
          type: notebook-function
          metadata:
            function_notebook_id: nb-config
            function_notebook_export_mappings:
              regions:
                enabled: true
                variable_name: regions
        - id: analyze
          blockGroup: g-analyze
          sortingKey: b0
          type: notebook-function
          metadata:
            function_notebook_id: nb-regional
            function_notebook_for_each: regions
            function_notebook_for_each_as: region
            function_notebook_inputs:
              region:
                variable_name: region
              trailing_months:
                custom_value: "6"
            function_notebook_export_mappings:
              summary_json:
                enabled: true
                variable_name: summaries
              quality_score:
                enabled: true
                variable_name: qualityScores
        - id: escalate
          blockGroup: g-escalate
          sortingKey: c0
          type: notebook-function
          metadata:
            function_notebook_id: nb-escalate
            function_notebook_run_if: qualityScores[0] < 0.95 || qualityScores[1] < 0.95
            function_notebook_allow_failure: true
            function_notebook_export_mappings:
              ticket:
                enabled: true
                variable_name: ticket
        - id: report
          blockGroup: g-report
          sortingKey: d0
          type: notebook-function
          metadata:
            function_notebook_id: nb-report
            function_notebook_inputs:
              summaries_json:
                variable_name: summaries
              ticket:
                variable_name: ticket
                fallback:
                  custom_value: none
```

`analyze` runs once per element of `regions` and collects `summaries` and `qualityScores`. `escalate` depends on `analyze` through its condition alone, and a failure there does not stop the run. `report` depends on both; when `escalate` was skipped or failed, `ticket` is `"none"` rather than the step being skipped.
