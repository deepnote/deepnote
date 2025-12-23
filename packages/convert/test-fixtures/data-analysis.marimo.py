import marimo

__generated_with = "0.10.0"
app = marimo.App(width="medium", title="Data Analysis Example")


@app.cell
def __():
    import marimo as mo
    return mo,


@app.cell
def __(mo):
    mo.md(r"""
    # Data Analysis Example

    This notebook demonstrates a typical data analysis workflow using pandas.
    """)
    return


@app.cell
def __():
    import pandas as pd
    import numpy as np
    return np, pd,


@app.cell
def __(np, pd):
    # Create sample data
    np.random.seed(42)
    data = {
        'name': ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'],
        'age': [25, 30, 35, 28, 32],
        'salary': [50000, 60000, 75000, 55000, 70000],
        'department': ['Engineering', 'Marketing', 'Engineering', 'Sales', 'Marketing']
    }
    df = pd.DataFrame(data)
    return data, df,


@app.cell
def __(mo):
    mo.md(r"""
    ## Data Overview

    Let's examine the structure and summary statistics of our dataset.
    """)
    return


@app.cell
def __(df):
    print("Dataset Shape:", df.shape)
    print("\nColumn Types:")
    print(df.dtypes)
    return


@app.cell
def __(df):
    # Summary statistics
    df.describe()
    return


@app.cell
def __(mo):
    mo.md(r"""
    ## Analysis by Department

    Group the data by department and calculate mean values.
    """)
    return


@app.cell
def __(df):
    department_stats = df.groupby('department').agg({
        'age': 'mean',
        'salary': ['mean', 'min', 'max']
    })
    print(department_stats)
    return department_stats,


@app.cell
def __(mo):
    mo.md(r"""
    ## Conclusion

    This analysis shows the distribution of employees across departments.
    """)
    return


if __name__ == "__main__":
    app.run()


