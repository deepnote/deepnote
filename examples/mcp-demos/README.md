# MCP-Generated Example Notebooks

These example notebooks were created using the **Deepnote MCP Server**, demonstrating how AI assistants can generate complete, interactive data science notebooks in seconds.

## Examples Overview

Each example is inspired by real-world use cases from [Deepnote customers](https://deepnote.com/customers).

| Example                                                    | Use Case                      | Industry                       | MCP Tools Used               |
| ---------------------------------------------------------- | ----------------------------- | ------------------------------ | ---------------------------- |
| [SaaS Metrics Dashboard](saas_metrics_dashboard.deepnote)  | KPI tracking, cohort analysis | SaaS (Slido, Statsig)          | `template` + `enhance`       |
| [Customer Churn Prediction](churn_prediction.deepnote)     | ML classification model       | FinTech (Ramp, Gusto)          | `scaffold` + `test`          |
| [A/B Test Evaluator](ab_test_evaluator.deepnote)           | Statistical experimentation   | Gaming (Homa, Statsig)         | `scaffold` + `enhance`       |
| [Financial Analytics Report](financial_analytics.deepnote) | Portfolio analysis, reporting | Finance (Hedge Funds)          | `template` (report)          |
| [ETL Data Pipeline](etl_data_pipeline.deepnote)            | Data engineering workflows    | Logistics (foodpanda, Shippit) | `template` (etl) + `profile` |
| [API Analytics Client](api_analytics_client.deepnote)      | External API integration      | Media (SoundCloud, Webflow)    | `template` (api_client)      |

## How These Were Created

### Using Templates

```bash
# Create a dashboard from template
deepnote_template --template=dashboard --outputPath=my_dashboard.deepnote

# Available templates: dashboard, ml_pipeline, etl, report, api_client
```

### Using Natural Language Scaffolding

```bash
# Describe what you want and get a complete notebook
deepnote_scaffold \
  --description="Customer churn prediction with feature engineering and model evaluation" \
  --outputPath=churn_model.deepnote \
  --style=tutorial
```

### Enhancing Notebooks

```bash
# Add interactivity, documentation, and visualizations
deepnote_enhance --path=my_notebook.deepnote --enhancements=all
```

### Using Workflows

Chain multiple operations together:

```bash
deepnote_workflow --steps='[
  {"tool": "template", "args": {"template": "ml_pipeline"}},
  {"tool": "enhance", "args": {"enhancements": ["inputs", "documentation"]}},
  {"tool": "suggest", "args": {}}
]'
```

## Features Demonstrated

### Interactive Input Blocks

Each notebook includes configurable parameters:

- **Text inputs** for file paths and API keys
- **Sliders** for hyperparameters and thresholds
- **Date range pickers** for filtering
- **Select dropdowns** for categories

### Documentation & Structure

- Clear section headers
- Markdown explanations
- Code comments
- Executive summaries (in reports)

### Visualizations

- Charts and graphs
- Confusion matrices
- Big-number KPIs
- Data tables

### Profiling (ETL example)

- Execution timing per block
- Memory usage tracking
- Performance bottleneck identification

## Try It Yourself

1. Install the Deepnote MCP server:

   ```bash
   npm install -g @deepnote/mcp
   ```

2. Configure your MCP client (e.g., Cursor):

   ```json
   {
     "mcpServers": {
       "deepnote": {
         "command": "npx",
         "args": ["@deepnote/mcp"]
       }
     }
   }
   ```

3. Ask your AI assistant to create a notebook:
   > "Create a sales analytics dashboard with date filters and revenue KPIs"

## Learn More

- [MCP Package README](../../packages/mcp/README.md)
- [Deepnote Documentation](https://deepnote.com/docs)
- [MCP Specification](https://modelcontextprotocol.io)
