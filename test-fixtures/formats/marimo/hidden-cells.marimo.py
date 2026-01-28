import marimo

app = marimo.App()

@app.cell(hide_code=True)
def __():
    print("hidden")
    return

@app.cell(hide_code=True, disabled=True)
def __():
    print("hidden and disabled")
    return

@app.cell
def __():
    print("normal cell")
    return

if __name__ == "__main__":
    app.run()
