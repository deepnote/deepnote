---
title: SQL generation
description: Generate SQL queries by using Deepnote AI’s awareness of your database’s schema
noIndex: false
noContent: false
---

Deepnote AI can generate SQL queries based on your instructions in natural language. Simply click on the AI button in a SQL block and enter your prompt into the AI input. After submitting, Deepnote AI will interpret your instructions, search for relevant tables in your database or warehouse integration and combine them together with additional context in order to generate a valid SQL query. The generated query will adhere to the particular SQL dialect of the connected integration.

![sql_ai-generating_sql.gif](https://media.graphassets.com/pGG20jLRlWMaILwZd9sS)

Under the hood Deepnote AI is searching your schema for tables which it deems to be relevant. This may take a few seconds, especially if the schema of your integration is large. You can help navigate Deepnote AI to the exact tables that you would like it to use by mentioning them in your prompt. Feel free to check out more [tips and tricks](https://deepnote.com/docs/prompting-tips-and-tricks) on how to effectively work with Deepnote AI

### Editing, Explaining and Fixing

You can edit your existing SQL queries by clicking on the AI button in a SQL block. Simply describe the changes which you would like Deepnote AI to apply and it will again inspect the schema of your database and pull relevant context from your notebook for its changes.

![sql_ai-editing_sql.gif](https://media.graphassets.com/Tj1weG0TTtaBZrjjvpNK)

Should your SQL hit an error, you can use Deepnote AI to fix it. You can also click on the "Fix with Deepnote AI" button appearing next to your SQL error message. If you're coming back to an older notebook or simply aren't sure about what a particular SQL query does, you can benefit from the Explain command which describes a SQL query in natural language.

### Leveraging additional context

Same as with other Deepnote AI features, Deepnote AI leverages your particular context, such as the contents of your notebook for accurate SQL generations. Notice how Deepnote AI picks up what we mean by "relevant companies" in the SQL query below, querying companies from the financial sector:

![effective_prompting-additional_instructions.gif](https://media.graphassets.com/AuuKD2GSLqUHyUKx4YHl)

### Keeping your database schema up to date

In order for SQL AI to work, Deepnote has to have access to your database’s schema. Schema of your database is pulled automatically when connecting an integration to a project. You can also [manually refresh a schema](https://deepnote.com/docs/schema-browser#refreshing-the-schema) to pull the latest version.

<Callout status="warning">Upon pulling your schema, Deepnote AI will scan it and set itself up in order to work properly. This process may take a couple of minutes, especially if your database schema is very large</Callout>

![sql_ai-refreshing_schema.gif](https://media.graphassets.com/cBh6SihHR1ikY6CkbLQd)

### Generating DataFrame SQL

You can also use Deepnote AI to generate a query, [querying your DataFrames with SQL](https://deepnote.com/docs/sql-cells#sql-blocks-and-pandas-dataframes). Just trigger Deepnote AI in a DataFrame SQL block and mention the name of the DataFrame variable which you would like to query. Deepnote AI will automatically acquire the schema of the mentioned DataFrame from the [Variable explorer](https://deepnote.com/docs/variable-explorer) including the column names and column data types. Editing and Fixing with Deepnote AI also works for DataFrame SQL.

![sql_ai-dataframe_sql.gif](https://media.graphassets.com/4U2xYR8SQjGHcU4BAS4V)

### Providing feedback

If you would like to provide feedback, you can do so by using the built-in 👍/👎 buttons or by reaching out directly to gabor@deepnote.com or ondrej@deepnote.com

![sql-ai-providing-feedback.gif](https://media.graphassets.com/ofo8kI4gSemJkOi8D7W4)

### Troubleshooting

Q: I am getting `No tables found` error message when trying to use SQL AI.
A: This is most likely caused by Deepnote AI not completing its set up in time. The initial setup may take a couple of minutes, so please be patient. Read more on how to [keep your database schema up to date](https://deepnote.com/docs/sql-generation#keeping-your-database-schema-up-to-date).

Q: I am getting the following error message: `AI in SQL is not currently supported for integrations using federated auth`.
A: Integrations using federated auth such as [BigQuery with Google OAuth](https://deepnote.com/docs/bigquery-oauth) or [Snowflake with Okta](https://deepnote.com/docs/snowflake-with-okta) aren’t currently supported.
