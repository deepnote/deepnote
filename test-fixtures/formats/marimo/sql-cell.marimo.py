import marimo

app = marimo.App()

@app.cell
def _(engine):
    df = mo.sql(
        f"""
        SELECT * FROM film
        """,
        engine=engine
    )
    return (df,)

if __name__ == "__main__":
    app.run()
