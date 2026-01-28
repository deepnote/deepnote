import marimo

__generated_with = "0.18.4"
app = marimo.App(width="medium", auto_download=["ipynb", "html"])


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    `sum(a, b)` - Adds two numbers together
    """)
    return


@app.cell
def _():
    import marimo as mo
    return (mo,)


@app.function
def sum(a: float, b: float) -> float:
    return a + b


@app.cell
def _():
    total = sum(14.99, 23.00)

    total
    return


if __name__ == "__main__":
    app.run()
