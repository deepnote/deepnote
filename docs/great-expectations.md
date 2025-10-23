---
title: Great Expectations
noIndex: false
noContent: false
coverImage: Cmrw0cuMRM27f01LiMEV
---

<Callout status="info">

**Want to get started right away?** Jump right into Deepnote and view a sample workflow using Great Expectations [here](https://deepnote.com/@Deepnote-lessgreater-GE/Great-Expectations-in-Deepnote-5119d502-592c-43bd-b99d-244e09f7080a).

</Callout>

Great Expectations (GE) is a tool for data testing and documentation. Onboarding to GE, however, usually comes with a few challenges for newcomers such as switching between multiple notebooks, using the terminal, and hosting documentation. This guide will fast-forward you through any pain points and enable you to bring the software development discipline of automated testing to your data science team.

### How to set it up

All default Python environments in Deepnote come with preinstalled Pandas (learn more about all preinstalled packages [here](/docs/pre-installed-packages)). GE can be installed through a simple `!pip install great_expectations` . All that is needed to get started with GE, then, is to initialize GE via `!great_expectations --yes --v3-api init`. Note that both of these statements could also be run in a terminal within your Deepnote project (without the `!`, of course).

![spaces%2FtfH69m1V6bYYvquUay8O%2Fuploads%2FPus8irVJgvyrswZjsMRK%2FPUZZLE.png](https://media.graphassets.com/bYtaxTjqTo6i0LAR2LRk)

### How to use

Once initialized, you can start using Great Expectations within your notebooks. In the example below, three [Expectations](https://greatexpectations.io/expectations/) (tests) are defined on the fictitious `df_pass` Pandas DataFrame. In simple terms,

1. the `skill` cannot contain null values
2. the `runner` column must contain unique values
3. the `total_time` column must have values between 70 and 100

```python
# import pandas and great_expectations
import pandas as pd
import great_expectations as ge

# initialize a Pandas DataFrame
df_pass = ge.from_pandas(df_pass)

# define Expectations
df_pass.expect_column_values_to_not_be_null('skill')
df_pass.expect_column_values_to_be_unique('runner')
df_pass.expect_column_values_to_be_between('total_time', 70, 100)
```

### Next steps

Jump right into Deepnote & take a look at [this thorough walkthrough of Great Expectations in Deepnote](https://deepnote.com/@Deepnote-lessgreater-GE/Great-Expectations-in-Deepnote-5119d502-592c-43bd-b99d-244e09f7080a). You can also save yourself some setup work by hitting the `View source` button first before clicking on `Duplicate` in the top-right corner to start exploring on your own!
