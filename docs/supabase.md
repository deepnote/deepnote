---
title: Supabase
noIndex: false
noContent: false
---

This guide shows how to analyze the data in your Supabase Postgres database in Deepnote. We configure an integration that allows you to query the data and use them in an analysis or an automation workflow.

[Supabase](https://supabase.com/) is an open source Firebase alternative. Start your project with a Postgres Database, Authentication, instant APIs, Realtime subscriptions and Storage.

## Setup

### Step 1: Create a Supabase project

Go to [supabase.com](https://supabase.com/) and create a free account, and start a new project.

### Step 2: Get your database credentials ready

![Supabase credentials](https://media.graphassets.com/R1viC2QvqEjetTO9FLzw)

You will need the connections details for the database: host, database, port, user and password. You can find them in the settings of your Supabase project, in the Database section.

### Step 3: Create a Postgres integration in Deepnote

![ Create a Postgres integration in Deepnote](https://media.graphassets.com/GtjwnTvWTlVWEXTZwtCr)

Open Integrations in the left side bar, and select the Postgres integration. You will be prompted for the credentials from the previous step.

### Step 4: Create a new project, and start querying your data

![Create a new project](https://media.graphassets.com/LvtKgFIQTKdtwhKqWrRg)

When you create a new project, navigate to Integrations in the right side bar, and connect your database. This will allow you to:

- Insert and execute SQL blocks in your notebook
- Browse the schema

## Use cases

### Exploratory data analysis

You can ask analytical questions about your data and leverage the entire Python ecosystem. Visualize things like cumulative user count, or the popularity of various authentication providers. Create charts, forecasts or dashboards and organize them in your data workspace.

### Sharing reports

When you want to share the results or get some feedback, easily share your Deepnote projects with your colleagues or friends. Get their comments, or get some technical help with your code.

### Scheduled notebooks

Automate your work by scheduling notebooks. Create a simple ETL pipeline, or run a periodic clean up job.

## Resources

Learn more about [Supabase](https://supabase.com) or read its [documentation](https://supabase.com/docs/)
