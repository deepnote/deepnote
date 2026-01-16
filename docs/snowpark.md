---
title: Snowpark
description: Available to teams and users on all plans.
noIndex: false
noContent: false
---

![snowpark integration](https://media.graphassets.com/7k7ADpFQT84m2MlQSvV8)

<Callout status="info">
**Want to get started right away?** Click [here](https://deepnote.com/launch?template=Snowpark%20and%20Deepnote) to jump into a ready-to-go notebook that demonstrates Snowpark
</Callout>

With the new Snowpark integration in Deepnote you can perform database transformations with Python and deploy machine learning models to Snowflake—**without moving your data or changing the Python code you already use**.

The Snowpark + Deepnote integration makes the warehouse feels like an in-memory object. Simply write your code in Deepnote and manipulate your tables as if you were using Pandas. All compute occurs directly in the warehouse so there’s no need to constantly move your data around.

### How to connect

Begin by `pip` installing Snowpark inside of Deepnote. Note that **Snowpark requires Python 3.10 or later** (this can be selected from the [environments tab in Deepnote](/docs/custom-environments)).

```python
!pip install snowflake-snowpark-python
```

Then, instantiate Snowpark's session object. Its methods allow you to manipulate and interact with your Snowflake instance.

```python
from snowflake.snowpark.session import Session

# create the session
session = Session.builder.configs(credentials).create()
```

<Callout status="info">
Note that `credentials` refers to a Python dictionary containing your warehouse details. Deepnote stores these securely with its [Environment Variables integration](/docs/environment-variables).
</Callout>

### How to use

The Snowpark provides a Pandas-like API and methods that correspond to the hundreds of SQL functions available in Snowflake. For a full list of functions including how to define your own functions (i.e., UDFs), see the API reference [here](https://docs.snowflake.com/en/developer-guide/snowpark/reference/python/_autosummary/snowflake.snowpark.functions.html#module-snowflake.snowpark.functions).

<Callout status="info">
Snowpark operations are executed lazily on the server, which reduces the amount of data transferred between your client and the Snowflake database.
</Callout>

**Viewing a table's rows**

```python
session.table("my_table").sample(n=50)
```

#### Joining two tables

```python
dfDemo = session.table("DEMOGRAPHICS")
dfServ = session.table("SERVICES")
dfJoin = dfDemo.join(dfServ,dfDemo.col("CUSTOMERID") == dfServ.col("CUSTOMERID"))
```

**Converting a table to a Pandas DataFrame**

```python
# this will bring a copy of the table into the notebook's memory
df = dfJoin.to_pandas()
```

**Write a new table to the warehouse**

```python
dfJoin.write.mode('overwrite').saveAsTable('MY_NEW_TABLE')
```

**Calculating the average of a column**

```python
# import the avg function
from snowflake.snowpark.functions import avg

# calculate average and return the result with .show()
df.select(avg("my_column")).show()
```

### Next steps

To learn more about the many things you can do in Snowpark, including deploying machine learning models, see this [tutorial notebook](https://deepnote.com/launch?template=Snowpark%20and%20Deepnote) and read the [Snowpark documentation](https://docs.snowflake.com/en/developer-guide/snowpark/index.html).
