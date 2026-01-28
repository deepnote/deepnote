import marimo

app = marimo.App()

@app.cell
def __():
    import pandas as pd
    return pd,

@app.cell
def __(pd):
    df = pd.read_csv("data.csv")
    return df,

@app.cell
def __(df, np, pd):
    result = df.mean()
    return result,

if __name__ == "__main__":
    app.run()
