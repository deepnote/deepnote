import marimo

app = marimo.App()

@app.cell
def __():
    hashtag = "#trending"
    comment = "This has a # in it"
    return hashtag, comment,

@app.cell
def __():
    text = "She said, \"hello, there\""
    other = 'It\'s a test'
    return text, other,

if __name__ == "__main__":
    app.run()
