# %% [markdown]
# # Data Analysis Example
#
# This notebook demonstrates a typical data analysis workflow using pandas.

# %%
import pandas as pd
import numpy as np

# Create sample data
np.random.seed(42)
data = {
    'name': ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'],
    'age': [25, 30, 35, 28, 32],
    'salary': [50000, 60000, 75000, 55000, 70000],
    'department': ['Engineering', 'Marketing', 'Engineering', 'Sales', 'Marketing']
}
df = pd.DataFrame(data)

# %% [markdown]
# ## Data Overview
#
# Let's examine the structure and summary statistics of our dataset.

# %%
print("Dataset Shape:", df.shape)
print("\nColumn Types:")
print(df.dtypes)

# %% tags=["exploration"]
# Summary statistics
df.describe()

# %% [markdown]
# ## Analysis by Department
#
# Group the data by department and calculate mean values.

# %% Analysis code tags=["analysis", "groupby"]
department_stats = df.groupby('department').agg({
    'age': 'mean',
    'salary': ['mean', 'min', 'max']
})
print(department_stats)

# %% [markdown]
# ## Conclusion
#
# This analysis shows the distribution of employees across departments.


