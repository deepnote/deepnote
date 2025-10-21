---
title: Scheduling
noIndex: false
noContent: false
---

Deepnote lets you execute your notebooks on a daily, weekly, monthly or hourly basis, or with a custom cron string. This is useful if you want to process data or update a dashboard at a regular frequency.

<Callout  status="info">
Scheduling is available on Team, Pro and Enterprise plans. Hourly and custom schedule is available on Enterprise plan only.
</Callout>

### From exploratory analysis to production pipelines

Deepnote makes it easy to take your explorations to production. For example:

1. Imagine you build a churn prediction model and store it in the filesystem. You can add a second notebook to your project which runs on a weekly basis, fetches the activity data of your customers from the warehouse, runs a prediction, and triggers a retention campaign.
2. You can build a lead scoring model, and [create an app](/docs/creating-apps) which displays the most promising leads to your account executives. However, since you have so many leads and a very advanced model, the process might take a bit of time. You can schedule the notebook to run just before the sales team comes to work, so that the app contains fresh info whenever as soon as they open it.

### How to schedule a notebook

1. Click the calendar icon **Schedule notebook**, which is at the top of the notebook, right next to the **Run notebook** button
2. Configure the frequency at which you would like the notebook to run and then click **Save.**
3. Additionally, you can also configure notifications for successful and failed runs, either by email or into Slack.

![Scheduling notifications.jpg](https://media.graphassets.com/5vnhJjTRfuHyBA0aJTNC)

### How to know if your scheduled notebook ran successfully

If an exception is raised during the run, the run is considered as failed, otherwise it's successful. Please note that if an error is raised in a block, the subsequent blocks are not executed. In addition, you will find a log and snapshot of successful and/or failed runs in the _Version history_ Tab.

![Scheduling versions.jpg](https://media.graphassets.com/5NYCPGefRZScMa2R0l8S)

### Alerts

You can use the scheduled notebook to periodically check the consistency of your data and use the notification system to alert you when the notebook fails (i.e. the consistency check fails).

### Current limitations

- Only one scheduled notebook per project is supported. If you need to schedule more, we recommend splitting the work across multiple projects.
