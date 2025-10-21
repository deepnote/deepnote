---
title: Telegram
noIndex: false
noContent: false
---

![Telegram & Deepnote](https://media.graphassets.com/SVsS0TITFN05V8eXMgRR)

Telegram is a messaging app with a focus on speed and security It's fast, simple, and free. You can use Telegram on all your devices at the same time — your messages sync seamlessly across any number of your phones, tablets, or computers. This guide walks you through using Telegram to deliver notifications at different points of your data workflows on Deepnote (like delivering machine learning model training updates).

![Telegram notifications](https://media.graphassets.com/5NDfLBAT9uSucPOvStPy)

### How to set it up

The first step in integrating Telegram with your Deepnote notebooks is creating a Telegram bot. Luckily, all you need to do is message the `Botfather` (yes, that's the name of the bot that can create bots). Telegram provides [great documentation and examples](https://core.telegram.org/bots) on how to create a bot using the `Botfather`.

Once you've created a bot, you'll need two pieces of information:

1. **`BOT_TOKEN`**: This token allows Telegram to recognize you're authorized to use this bot to send messages.
2. **`CHAT_ID`**: The ID of the chat you're trying to send your notifications to.

Take a look at [this section](https://core.telegram.org/bots/api#authorizing-your-bot) of Telegram's documentation to find out where to retrieve your `BOT_TOKEN` and `CHAT_ID`. Once you've found them, consider storing both as environment variables in Deepnote for security purposes. [Environment variables in Deepnote](/docs/environment-variables) are encrypted and offer a secure way to store sensitive data.

### How to use

Once you've stored the `BOT_TOKEN` and `CHAT_ID` as environment variables, all that's needed to send messages is a simple function that sends the notification string to you via Telegram's API. Here's an example of what that could look like:

```
import requests
import os

def telegram_sendtext(bot_message):
    send_text = 'https://api.telegram.org/bot' + os.environ["BOT_TOKEN"] + '/sendMessage'
    response = requests.get(send_text, params={'chat_id': os.environ["CHAT_ID"], 'parse_mode': 'Markdown', 'text': bot_message})
    return response.json()
```
