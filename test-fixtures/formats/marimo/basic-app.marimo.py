import marimo

app = marimo.App()

@app.cell
def __():
    print("hello")
    return

if __name__ == "__main__":
    app.run()
