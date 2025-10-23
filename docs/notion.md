---
title: Notion
description: Available to teams and users on all plans.
noIndex: false
noContent: false
coverImage: w2F4ok5iRlyQ4maT5G3m
---

<Callout status="info">
**Want to get started right away?** Jump right in and explore [this hands-on example](https://deepnote.notion.site/Bringing-analytics-to-Notion-with-Deepnote-d6ad9e9cf62f4b0ab425eec25c3f8f4b) of querying Notion databases using Deepnote and embedding the results on Notion.
</Callout>

Notion is an all-in-one workspace that allows for everything from simple note-taking to building knowledge libraries for entire organizations. Since Notion stores data in databases, you can actually query the data stored in Notion and analyze it using Deepnote. After visualizing your data, you can then go full-circle by bringing the plots back into Notion by embedding your Deepnote blocks into Notion pages.

![Notion and Deepnote workflow](https://media.graphassets.com/LuOWv7d4Qku2NVuInmU6)

### How to set it up

The first step in querying your Notion databases is retrieving your Notion API key and the ID of the database you would like to query. To gather all necessary information, head on over to [Notion's brilliant documentation](https://developers.notion.com/docs/getting-started) that offers a step-by-step walkthrough. To find your database ID, open up the Notion page containing the database and take a look at the URL. It should take the form of `https://www.notion.so/<hash1>?v=<hash2>`, where `<hash_1>` is your database ID and `<hash_2>` is the view ID.\

Once you've set up Notion's API, consider storing both the API key and database ID as an [environment variable](/docs/environment-variables). Environment variables in Deepnote are encrypted and provide a secure way of storing sensitive data.

### How to use

#### Query Notion databases

Once you've stored your Notion API key and database ID as environment variables, you can start querying. The code below queries a Notion database and saves it as a Pandas DataFrame that you can then use for further analyses.

```python
import os
import requests
import pandas as pd

# keys are stored in env vars to be hidden from users
api_key = os.environ["NOTION_API_KEY"]
database_id = os.environ["DATABASE_ID"]

# define request to Notion API
headers = {
    "Authorization": f"Bearer {api_key}",
    "Notion-Version": "2021-08-16",
    "Content-Type": "application/json",
}

# load first page
response = requests.post(
    f"https://api.notion.com/v1/databases/{database_id}/query", headers=headers
).json()

# iteratively load all pages
records = response["results"]
while response["has_more"]:
    response = requests.post(
        f"https://api.notion.com/v1/databases/{database_id}/query",
        json={"start_cursor": response["next_cursor"]},
        headers=headers,
    ).json()

# define a helper function to transform the JSON to a Pandas DF
def get_raw_value(item):
    item_type = item['type']
    if type(item[item_type]) is list:
        if item[item_type][0]['type'] == 'text':
            return item[item_type][0]['plain_text']
    return item[item_type]

# create Pandas DF
all_values = []
for record in records:
    properties = record['properties']
    all_values.append({
        'Name': get_raw_value(properties['Name']),
        'Total': get_raw_value(properties['Total']),
    })

df = pd.DataFrame(all_values)
df
```

#### Embed Deepnote blocks into Notion pages

After reading your Notion databases, performing analyses using the data, and creating visualizations, you might want to bring your Notion blocks back into Notion. That's where [shared blocks](/docs/sharing-and-embedding-blocks) come into play. Deepnote allows for the sharing and embedding of individual blocks. It's up to you whether you want to include the code and output or only one of the two.

![Embedding Deepnote blocks into a Notion page](https://media.graphassets.com/hYvEAUk3TOhQoxZklVQu)

### Next steps

Jump right in and explore [this hands-on example](https://deepnote.notion.site/Bringing-analytics-to-Notion-with-Deepnote-d6ad9e9cf62f4b0ab425eec25c3f8f4b) of querying Notion databases using Deepnote and embedding the results on Notion. You can also save yourself some setup work by copying the workflow used in the example to start querying your own Notion databases!
