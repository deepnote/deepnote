import marimo

__generated_with = "0.10.0"
app = marimo.App(width="full", title="My Notebook")

@app.cell
def __():
    print("hello")
    return

if __name__ == "__main__":
    app.run()
