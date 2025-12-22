import marimo

__generated_with = "0.10.0"
app = marimo.App(width="medium")


@app.cell
def __():
    import marimo as mo
    return mo,


@app.cell
def __(mo):
    mo.md(r"""
    # Hello World

    This is a simple Marimo notebook.
    """)
    return


@app.cell
def __():
    print("Hello, World!")
    return


@app.cell
def __():
    x = 10
    y = 20
    result = x + y
    print(f"Result: {result}")
    return result, x, y,


if __name__ == "__main__":
    app.run()


