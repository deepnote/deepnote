---
title: Working with Jupyter notebooks
description: Deepnote is compatible with core Jupyter notebook functionalities.
noIndex: false
noContent: false
---

## How to import `.ipynb` files

There are two ways to import `.ipynb` files into a Deepnote project:

1. Drag and drop `.ipynb` files into the **NOTEBOOKS** section in the left panel.

![Drag an .ipynb file into the Notebooks section](../assets/docs/importing-and-exporting-jupyter-notebooks/drag-and-drop-notebooks.webp)
<br></br><br></br>

2.1 In the right sidebar, click the **+** button in the **Files** section and select **Upload .ipynb file**.

![Upload an .ipynb file from the Files menu](../assets/docs/importing-and-exporting-jupyter-notebooks/upload-ipynb-menu.webp)

2.2 After uploading the file, open it and select **Move to notebooks**. The file appears in the **Notebooks** section, where you can open it and start working.

![Move an uploaded .ipynb file to Notebooks](../assets/docs/importing-and-exporting-jupyter-notebooks/move-ipynb-to-notebooks.webp)
<br></br><br></br>

## How to export `.ipynb` files

In the left panel's **Notebooks** section, open the notebook's actions menu, choose **Export as ...**, then select **.ipynb**.

![Export a notebook as an .ipynb file](../assets/docs/importing-and-exporting-jupyter-notebooks/export-ipynb-menu.webp)

Need a different output format? You can also convert [Jupyter notebooks to PDF](https://deepnote.com/ipynb-to-pdf) when you want a readable document to share with stakeholders who don't need to run the code.

<Callout status="info">

While we do our best to maintain compatibility with Jupyter, specialized blocks in Deepnote cannot be represented exactly in Jupyter (e.g., SQL, chart, input, and rich text blocks). Upon export, queries in SQL blocks will be converted to a string representation and rich text blocks will be converted to Markdown.

</Callout>
