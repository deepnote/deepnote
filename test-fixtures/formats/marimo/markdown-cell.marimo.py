import marimo

app = marimo.App()

@app.cell
def __():
    import marimo as mo
    return mo,

@app.cell
def __(mo):
    mo.md(r"""
    # Hello World

    This is markdown.
    """)
    return

if __name__ == "__main__":
    app.run()
