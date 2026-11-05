---
title: "Playbook: business alerts from a scheduled notebook"
description: Turn a scheduled Deepnote notebook into an alert for business conditions such as a revenue drop or a stalled pipeline, with the numbers in the message and a link to the analysis, without a separate alerting tool
noIndex: false
noContent: false
---

Most alerting tools watch servers. The alerts a business team wants are different: sign-ups fell 30% against last week, a large customer stopped using the product, refunds spiked in one country. The logic for these already lives in SQL and Python, which is what a Deepnote notebook runs.

This playbook shows two ways to turn a scheduled notebook into an alert, and how to choose between them.

## What you'll combine

| Feature                                              | Role in this playbook                            |
| ---------------------------------------------------- | ------------------------------------------------ |
| SQL blocks and Python                                | The condition                                    |
| [Scheduling](/docs/scheduling)                       | Checks the condition every hour or every day     |
| Schedule notifications                               | Simple alerts through Slack or email             |
| [Environment variables](/docs/environment-variables) | Store the webhook or bot token for richer alerts |
| [Slack](/docs/slack) or [Telegram](/docs/telegram)   | Where alerts arrive                              |
| [Run snapshots](/docs/run-snapshots)                 | The data each alert was based on                 |
| [Notebook apps](/docs/data-apps)                     | Where people go to investigate                   |

## Option 1: raise an error and use schedule notifications

The simplest alert needs no code beyond the check. End the notebook with a block that raises when the condition is met:

```python
drop = 1 - this_week / last_week
if drop > 0.3:
    raise RuntimeError(f"Sign-ups fell {drop:.0%} week over week ({this_week} vs {last_week})")
```

Schedule the notebook and add a failure notification for a Slack channel or for email recipients from your workspace. When the condition is met, the run fails and the notification goes out.

This works well for a small team, but has three limits:

- **The message is generic.** A failure notification says that a scheduled job failed for the project and links to the notebook. It doesn't include your error message, so people have to click through to see the numbers.
- **Alerts and errors look the same.** A real error, such as an expired credential, produces the same notification as the business condition.
- **Repeated alerts pause the schedule.** Every raise counts as a failure. If auto-pause is on, which is the default for new schedules, three alerts in a row pause the schedule, and you stop being told. For this pattern, turn auto-pause off or raise its threshold.

## Option 2: send the message from the notebook

For alerts people act on, send the message yourself, with the numbers and a link, and let the run succeed.

1. Create an [incoming webhook](https://api.slack.com/messaging/webhooks) for the Slack channel, or a [Telegram bot](/docs/telegram).
2. Store the webhook URL or bot token in an [environment variables integration](/docs/environment-variables) and connect it to the project.
3. End the notebook with a block that posts only when the condition is met:

```python
import os

import requests

drop = 1 - this_week / last_week
if drop > 0.3:
    requests.post(
        os.environ["SLACK_ALERTS_WEBHOOK"],
        json={
            "text": (
                f":warning: Sign-ups fell {drop:.0%} week over week ({this_week} vs {last_week}).\n"
                "Breakdown by channel: https://deepnote.com/app/your-workspace/Sign-up-health-<id>"
            )
        },
        timeout=30,
    ).raise_for_status()
```

Keep a schedule **failure** notification as well, sent to the people who maintain the notebook. Business alerts then go to the business channel, and broken runs go to the maintainers, with auto-pause protecting both.

## Make alerts worth reading

- **Include the numbers and the comparison** in the message, so people can judge it without clicking.
- **Link to an app, not the notebook.** Publish a notebook [app](/docs/data-apps) that breaks the number down, and put its link in the alert. Add input values to the link, such as `?country=DE&__run=true`, to open the app on the right slice.
- **Compare like with like.** Compare against the same weekday last week or a trailing average rather than yesterday, to avoid alerting on every weekend.
- **Run at the right frequency.** Hourly checks are available on Team. Checking more often than hourly needs Enterprise.
- **Keep the evidence.** Every scheduled run creates a [run snapshot](/docs/run-snapshots), so you can see what the data looked like when an alert fired.

## Security

- The webhook URL or bot token is a secret. Keep it in an environment variables integration, which stores it encrypted, rather than in a code block.
- The scheduled run executes as the schedule's owner. If they leave the workspace, the schedule pauses until someone else saves it and becomes its owner. A paused alert is silent, so send the schedule's failure notifications to a shared channel and agree who takes the schedule over when its owner leaves.

## Plan requirements

- **Scheduling, including hourly schedules:** Team and Enterprise.
- **Schedules more frequent than hourly:** Enterprise.

## Variations

- **Customer health:** alert the account owner's channel when a top-50 account's weekly active users fall by half.
- **Operations:** alert when the backlog of unshipped orders older than 48 hours exceeds a threshold, with the oldest orders listed in the message.
- **Finance:** alert when daily refunds in any country exceed three times their 30-day average.
