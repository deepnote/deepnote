import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deserializeDeepnoteFile } from '@deepnote/blocks'
import * as uuid from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { convertIpynbFilesToDeepnoteFile, convertJupyterNotebookToBlocks } from './jupyter-to-deepnote'

// Mock uuid to generate predictable IDs for testing
vi.mock('uuid', async () => {
  const actual = await vi.importActual<typeof import('uuid')>('uuid')
  let counter = 0
  const mockV4 = vi.fn(() => {
    counter++
    return `test-uuid-${counter.toString().padStart(3, '0')}`
  })
  // Attach reset function to the mock
  ;(mockV4 as typeof mockV4 & { __resetCounter: () => void }).__resetCounter = () => {
    counter = 0
  }
  return {
    ...actual,
    v4: mockV4,
  }
})

// Helper to get the mocked uuid.v4 with reset function
function getMockedUuidV4() {
  return vi.mocked(uuid.v4) as ReturnType<typeof vi.mocked<typeof uuid.v4>> & { __resetCounter: () => void }
}

describe('createSortingKey', () => {
  // We need to test the internal function via its behavior in the output
  // Since it's not exported, we'll validate sorting keys through conversion tests

  it('generates correct sorting keys for first few indices', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-test-'))
    const outputPath = path.join(tempDir, 'test.deepnote')

    try {
      const mockedV4 = getMockedUuidV4()
      mockedV4.mockClear()
      mockedV4.__resetCounter()

      await convertIpynbFilesToDeepnoteFile([path.join(__dirname, '__fixtures__', 'simple.ipynb')], {
        outputPath,
        projectName: 'Test',
      })

      const content = await fs.readFile(outputPath, 'utf-8')
      const result = deserializeDeepnoteFile(content)

      // The sorting keys should be '0', '1', '2' for indices 0, 1, 2
      const sortingKeys = result.project.notebooks[0].blocks.map(b => b.sortingKey)
      expect(sortingKeys).toEqual(['0', '1', '2'])
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('generates correct sorting keys for larger indices', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-test-'))
    const outputPath = path.join(tempDir, 'test.deepnote')

    // Create a notebook with many cells to test larger indices
    const notebookWithManyCells = {
      cells: Array.from({ length: 40 }, (_, i) => ({
        cell_type: 'code' as const,
        execution_count: null,
        metadata: {},
        outputs: [],
        source: `# Cell ${i}`,
      })),
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    const inputPath = path.join(tempDir, 'many-cells.ipynb')

    try {
      await fs.writeFile(inputPath, JSON.stringify(notebookWithManyCells), 'utf-8')
      const mockedV4 = getMockedUuidV4()
      mockedV4.mockClear()
      mockedV4.__resetCounter()

      await convertIpynbFilesToDeepnoteFile([inputPath], { outputPath, projectName: 'Test' })

      const content = await fs.readFile(outputPath, 'utf-8')
      const result = deserializeDeepnoteFile(content)

      const sortingKeys = result.project.notebooks[0].blocks.map(b => b.sortingKey)

      // Verify some specific keys (bijective base-36)
      expect(sortingKeys[0]).toBe('0') // index 0
      expect(sortingKeys[9]).toBe('9') // index 9
      expect(sortingKeys[10]).toBe('a') // index 10
      expect(sortingKeys[35]).toBe('z') // index 35
      expect(sortingKeys[36]).toBe('00') // index 36 (wraps to two digits)
      expect(sortingKeys[37]).toBe('01') // index 37

      // Verify all keys are unique
      const uniqueKeys = new Set(sortingKeys)
      expect(uniqueKeys.size).toBe(sortingKeys.length)
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe('convertIpynbFilesToDeepnoteFile', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-test-'))
    // Reset the UUID counter before each test
    const mockedV4 = getMockedUuidV4()
    mockedV4.mockClear()
    mockedV4.__resetCounter()
    // Set a fixed date for deterministic timestamps
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
    vi.useRealTimers()
  })

  it('converts a single Jupyter notebook with markdown and code cells', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'simple.ipynb')
    const outputPath = path.join(tempDir, 'simple.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Simple Test',
    })

    // Verify the file was created
    const exists = await fs
      .access(outputPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)

    // Read and parse the output
    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    // Verify basic structure
    expect(result.version).toBe('1.0.0')
    expect(result.project.name).toBe('Simple Test')
    expect(result.project.notebooks).toHaveLength(1)

    // Verify notebook structure
    const notebook = result.project.notebooks[0]
    expect(notebook.name).toBe('simple')
    expect(notebook.executionMode).toBe('block')
    expect(notebook.blocks).toHaveLength(3)

    // Verify first block (markdown)
    const markdownBlock = notebook.blocks[0]
    expect(markdownBlock.type).toBe('markdown')
    expect(markdownBlock.content).toBe('# Hello World\n\nThis is a test notebook.')
    expect(markdownBlock.outputs).toBeUndefined()

    // Verify second block (code with string source)
    const codeBlock1 = notebook.blocks[1]
    expect(codeBlock1.type).toBe('code')
    expect(codeBlock1.content).toBe("print('Hello World')")
    expect(codeBlock1.executionCount).toBe(1)
    expect(codeBlock1.outputs).toEqual([])

    // Verify third block (code with array source)
    const codeBlock2 = notebook.blocks[2]
    expect(codeBlock2.type).toBe('code')
    expect(codeBlock2.content).toBe('import numpy as np\nimport pandas as pd')
    expect(codeBlock2.executionCount).toBe(2)
  })

  it('handles cells with source as string array', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'simple.ipynb')
    const outputPath = path.join(tempDir, 'array-source.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Array Source Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    // The third cell has source as an array
    const block = result.project.notebooks[0].blocks[2]
    expect(block.content).toBe('import numpy as np\nimport pandas as pd')
  })

  it('handles cells with null execution_count', async () => {
    const notebookPath = path.join(tempDir, 'null-execution.ipynb')
    const notebook = {
      cells: [
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: 'x = 1',
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

    const outputPath = path.join(tempDir, 'null-execution.deepnote')

    await convertIpynbFilesToDeepnoteFile([notebookPath], {
      outputPath,
      projectName: 'Null Execution Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    const block = result.project.notebooks[0].blocks[0]
    expect(block.executionCount).toBeUndefined()
  })

  it('converts multiple Jupyter notebooks into one Deepnote file', async () => {
    const inputPaths = [
      path.join(__dirname, '__fixtures__', 'notebook1.ipynb'),
      path.join(__dirname, '__fixtures__', 'notebook2.ipynb'),
    ]
    const outputPath = path.join(tempDir, 'multi.deepnote')

    await convertIpynbFilesToDeepnoteFile(inputPaths, {
      outputPath,
      projectName: 'Multi Notebook Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    // Verify we have two notebooks
    expect(result.project.notebooks).toHaveLength(2)

    // Verify first notebook
    const notebook1 = result.project.notebooks[0]
    expect(notebook1.name).toBe('notebook1')
    expect(notebook1.blocks).toHaveLength(2)
    expect(notebook1.blocks[0].content).toBe('# Notebook 1')
    expect(notebook1.blocks[1].content).toBe('x = 1')

    // Verify second notebook
    const notebook2 = result.project.notebooks[1]
    expect(notebook2.name).toBe('notebook2')
    expect(notebook2.blocks).toHaveLength(2)
    expect(notebook2.blocks[0].content).toBe('# Notebook 2')
    expect(notebook2.blocks[1].content).toBe('y = 2')
  })

  it('converts the real titanic tutorial notebook', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'titanic-tutorial.ipynb')
    const outputPath = path.join(tempDir, 'titanic.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Titanic Tutorial',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    // Verify basic structure
    expect(result.project.name).toBe('Titanic Tutorial')
    expect(result.project.notebooks).toHaveLength(1)

    const notebook = result.project.notebooks[0]
    expect(notebook.name).toBe('titanic-tutorial')

    // The titanic notebook should have 15 cells (mix of markdown and code)
    expect(notebook.blocks).toHaveLength(15)

    // Check some specific cells
    const firstCell = notebook.blocks[0]
    expect(firstCell.type).toBe('markdown')
    expect(firstCell.content).toContain('Logging into Kaggle')

    // Find a code cell
    const codeCells = notebook.blocks.filter(b => b.type === 'code')
    expect(codeCells.length).toBeGreaterThan(0)

    // Verify one of the code cells has expected content
    const importCell = codeCells.find(b => b.content?.includes('import numpy as np'))
    expect(importCell).toBeDefined()
    expect(importCell?.content).toContain('import pandas as pd')
  })

  it('generates valid UUIDs for all entities', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'simple.ipynb')
    const outputPath = path.join(tempDir, 'uuids.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'UUID Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    // Project should have an ID
    expect(result.project.id).toBeTruthy()

    // Each notebook should have an ID
    for (const notebook of result.project.notebooks) {
      expect(notebook.id).toBeTruthy()

      // Each block should have an ID and blockGroup
      for (const block of notebook.blocks) {
        expect(block.id).toBeTruthy()
        expect(block.blockGroup).toBeTruthy()
      }
    }
  })

  it('generates valid ISO timestamp for createdAt', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'simple.ipynb')
    const outputPath = path.join(tempDir, 'timestamp.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Timestamp Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    // Verify createdAt is a valid ISO timestamp
    expect(result.metadata.createdAt).toBeTruthy()
    const date = new Date(result.metadata.createdAt)
    expect(date.toISOString()).toBe(result.metadata.createdAt)
  })

  it('writes output as valid YAML', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'simple.ipynb')
    const outputPath = path.join(tempDir, 'yaml.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'YAML Test',
    })

    // Read the raw content
    const content = await fs.readFile(outputPath, 'utf-8')

    // Verify it starts with expected YAML structure
    expect(content).toContain('metadata:')
    expect(content).toContain('project:')
    expect(content).toContain('version:')

    // Verify it can be parsed by deserializeDeepnoteFile
    expect(() => deserializeDeepnoteFile(content)).not.toThrow()
  })

  it('preserves notebook outputs for code cells', async () => {
    const notebookPath = path.join(tempDir, 'with-outputs.ipynb')
    const notebook = {
      cells: [
        {
          cell_type: 'code',
          execution_count: 1,
          metadata: {},
          outputs: [
            {
              output_type: 'stream',
              name: 'stdout',
              text: ['Hello World\n'],
            },
          ],
          source: "print('Hello World')",
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

    const outputPath = path.join(tempDir, 'with-outputs.deepnote')

    await convertIpynbFilesToDeepnoteFile([notebookPath], {
      outputPath,
      projectName: 'Outputs Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    const block = result.project.notebooks[0].blocks[0]
    expect(block.outputs).toBeDefined()
    expect(block.outputs).toHaveLength(1)
    expect(block.outputs?.[0]).toEqual({
      output_type: 'stream',
      name: 'stdout',
      text: ['Hello World\n'],
    })
  })

  it('does not include outputs for markdown cells', async () => {
    const notebookPath = path.join(tempDir, 'markdown-only.ipynb')
    const notebook = {
      cells: [
        {
          cell_type: 'markdown',
          metadata: {},
          source: '# Title',
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }

    await fs.writeFile(notebookPath, JSON.stringify(notebook), 'utf-8')

    const outputPath = path.join(tempDir, 'markdown-only.deepnote')

    await convertIpynbFilesToDeepnoteFile([notebookPath], {
      outputPath,
      projectName: 'Markdown Only Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    const result = deserializeDeepnoteFile(content)

    const block = result.project.notebooks[0].blocks[0]
    expect(block.type).toBe('markdown')
    expect(block.outputs).toBeUndefined()
  })
})

describe('snapshot tests - exact YAML output format', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-test-'))
    // Reset the UUID counter before each test
    const mockedV4 = getMockedUuidV4()
    mockedV4.mockClear()
    mockedV4.__resetCounter()
    // Set a fixed date for deterministic timestamps
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
    vi.useRealTimers()
  })

  it('matches snapshot for simple.ipynb', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'simple.ipynb')
    const outputPath = path.join(tempDir, 'simple.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Simple Test',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    expect(content).toMatchInlineSnapshot(`
      "metadata:
        createdAt: 2024-01-15T10:30:00.000Z
      project:
        id: test-uuid-001
        integrations: []
        name: Simple Test
        notebooks:
          - blocks:
              - blockGroup: test-uuid-002
                content: |-
                  # Hello World

                  This is a test notebook.
                id: test-uuid-003
                metadata: {}
                sortingKey: "0"
                type: markdown
              - blockGroup: test-uuid-004
                content: print('Hello World')
                executionCount: 1
                id: test-uuid-005
                metadata: {}
                outputs: []
                sortingKey: "1"
                type: code
              - blockGroup: test-uuid-006
                content: |-
                  import numpy as np
                  import pandas as pd
                executionCount: 2
                id: test-uuid-007
                metadata: {}
                outputs: []
                sortingKey: "2"
                type: code
            executionMode: block
            id: test-uuid-008
            isModule: false
            name: simple
        settings: {}
      version: 1.0.0
      "
    `)
  })

  it('matches snapshot for notebook1.ipynb', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'notebook1.ipynb')
    const outputPath = path.join(tempDir, 'notebook1.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Notebook 1',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    expect(content).toMatchInlineSnapshot(`
      "metadata:
        createdAt: 2024-01-15T10:30:00.000Z
      project:
        id: test-uuid-001
        integrations: []
        name: Notebook 1
        notebooks:
          - blocks:
              - blockGroup: test-uuid-002
                content: "# Notebook 1"
                id: test-uuid-003
                metadata: {}
                sortingKey: "0"
                type: markdown
              - blockGroup: test-uuid-004
                content: x = 1
                executionCount: 1
                id: test-uuid-005
                metadata: {}
                outputs: []
                sortingKey: "1"
                type: code
            executionMode: block
            id: test-uuid-006
            isModule: false
            name: notebook1
        settings: {}
      version: 1.0.0
      "
    `)
  })

  it('matches snapshot for notebook2.ipynb', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'notebook2.ipynb')
    const outputPath = path.join(tempDir, 'notebook2.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Notebook 2',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    expect(content).toMatchInlineSnapshot(`
      "metadata:
        createdAt: 2024-01-15T10:30:00.000Z
      project:
        id: test-uuid-001
        integrations: []
        name: Notebook 2
        notebooks:
          - blocks:
              - blockGroup: test-uuid-002
                content: "# Notebook 2"
                id: test-uuid-003
                metadata: {}
                sortingKey: "0"
                type: markdown
              - blockGroup: test-uuid-004
                content: y = 2
                executionCount: 1
                id: test-uuid-005
                metadata: {}
                outputs: []
                sortingKey: "1"
                type: code
            executionMode: block
            id: test-uuid-006
            isModule: false
            name: notebook2
        settings: {}
      version: 1.0.0
      "
    `)
  })

  it('matches snapshot for titanic-tutorial.ipynb', async () => {
    const inputPath = path.join(__dirname, '__fixtures__', 'titanic-tutorial.ipynb')
    const outputPath = path.join(tempDir, 'titanic.deepnote')

    await convertIpynbFilesToDeepnoteFile([inputPath], {
      outputPath,
      projectName: 'Titanic Tutorial',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    expect(content).toMatchInlineSnapshot(`
      "metadata:
        createdAt: 2024-01-15T10:30:00.000Z
      project:
        id: test-uuid-001
        integrations: []
        name: Titanic Tutorial
        notebooks:
          - blocks:
              - blockGroup: test-uuid-002
                content: >-
                  Logging into Kaggle for the first time can be daunting. Our
                  competitions often have large cash prizes, public leaderboards, and
                  involve complex data. Nevertheless, we really think all data
                  scientists can rapidly learn from machine learning competitions and
                  meaningfully contribute to our community. To give you a clear
                  understanding of how our platform works and a mental model of the
                  type of learning you could do on Kaggle, we've created a Getting
                  Started tutorial for the Titanic competition. It walks you through
                  the initial steps required to get your first decent submission on
                  the leaderboard. By the end of the tutorial, you'll also have a
                  solid understanding of how to use Kaggle's online coding
                  environment, where you'll have trained your own machine learning
                  model.


                  So if this is your first time entering a Kaggle competition,
                  regardless of whether you:

                  - have experience with handling large datasets,

                  - haven't done much coding,

                  - are newer to data science, or

                  - are relatively experienced (but are just unfamiliar with Kaggle's
                  platform),


                  you're in the right place! 


                  # Part 1: Get started


                  In this section, you'll learn more about the competition and make
                  your first submission. 


                  ## Join the competition!


                  The first thing to do is to join the competition!  Open a new window
                  with **[the competition page](https://www.kaggle.com/c/titanic)**,
                  and click on the **"Join Competition"** button, if you haven't
                  already.  (_If you see a "Submit Predictions" button instead of a
                  "Join Competition" button, you have already joined the competition,
                  and don't need to do so again._)


                  ![](https://i.imgur.com/07cskyU.png)


                  This takes you to the rules acceptance page.  You must accept the
                  competition rules in order to participate.  These rules govern how
                  many submissions you can make per day, the maximum team size, and
                  other competition-specific details.   Then, click on **"I Understand
                  and Accept"** to indicate that you will abide by the competition
                  rules.


                  ## The challenge


                  The competition is simple: we want you to use the Titanic passenger
                  data (name, age, price of ticket, etc) to try to predict who will
                  survive and who will die.


                  ## The data


                  To take a look at the competition data, click on the **<a
                  href="https://www.kaggle.com/c/titanic/data" target="_blank"
                  rel="noopener noreferrer"><b>Data tab</b></a>** at the top of the
                  competition page.  Then, scroll down to find the list of files.  

                  There are three files in the data: (1) **train.csv**, (2)
                  **test.csv**, and (3) **gender_submission.csv**.


                  ### (1) train.csv


                  **train.csv** contains the details of a subset of the passengers on
                  board (891 passengers, to be exact -- where each passenger gets a
                  different row in the table).  To investigate this data, click on the
                  name of the file on the left of the screen.  Once you've done this,
                  you can view all of the data in the window.  


                  ![](https://i.imgur.com/cYsdt0n.png)


                  The values in the second column (**"Survived"**) can be used to
                  determine whether each passenger survived or not: 

                  - if it's a "1", the passenger survived.

                  - if it's a "0", the passenger died.


                  For instance, the first passenger listed in **train.csv** is Mr.
                  Owen Harris Braund.  He was 22 years old when he died on the
                  Titanic.


                  ### (2) test.csv


                  Using the patterns you find in **train.csv**, you have to predict
                  whether the other 418 passengers on board (in **test.csv**)
                  survived.  


                  Click on **test.csv** (on the left of the screen) to examine its
                  contents.  Note that **test.csv** does not have a **"Survived"**
                  column - this information is hidden from you, and how well you do at
                  predicting these hidden values will determine how highly you score
                  in the competition! 


                  ### (3) gender_submission.csv


                  The **gender_submission.csv** file is provided as an example that
                  shows how you should structure your predictions.  It predicts that
                  all female passengers survived, and all male passengers died.  Your
                  hypotheses regarding survival will probably be different, which will
                  lead to a different submission file.  But, just like this file, your
                  submission should have:

                  - a **"PassengerId"** column containing the IDs of each passenger
                  from **test.csv**.

                  - a **"Survived"** column (that you will create!) with a "1" for the
                  rows where you think the passenger survived, and a "0" where you
                  predict that the passenger died.
                id: test-uuid-003
                metadata: {}
                sortingKey: "0"
                type: markdown
              - blockGroup: test-uuid-004
                content: >-
                  # Part 2: Your coding environment


                  In this section, you'll train your own machine learning model to
                  improve your predictions.  _If you've never written code before or
                  don't have any experience with machine learning, don't worry!  We
                  don't assume any prior experience in this tutorial._


                  ## The Notebook


                  The first thing to do is to create a Kaggle Notebook where you'll
                  store all of your code.  You can use Kaggle Notebooks to getting up
                  and running with writing code quickly, and without having to install
                  anything on your computer.  (_If you are interested in deep
                  learning, we also offer free GPU access!_) 


                  Begin by clicking on the **<a
                  href="https://www.kaggle.com/c/titanic/kernels" target="_blank">Code
                  tab</a>** on the competition page.  Then, click on **"New
                  Notebook"**.


                  ![](https://i.imgur.com/v2i82Xd.png)


                  Your notebook will take a few seconds to load.  In the top left
                  corner, you can see the name of your notebook -- something like
                  **"kernel2daed3cd79"**.


                  ![](https://i.imgur.com/64ZFT1L.png)


                  You can edit the name by clicking on it.  Change it to something
                  more descriptive, like **"Getting Started with Titanic"**.  


                  ![](https://i.imgur.com/uwyvzXq.png)


                  ## Your first lines of code


                  When you start a new notebook, it has two gray boxes for storing
                  code.  We refer to these gray boxes as "code cells".


                  ![](https://i.imgur.com/q9mwkZM.png)


                  The first code cell already has some code in it.  To run this code,
                  put your cursor in the code cell.  (_If your cursor is in the right
                  place, you'll notice a blue vertical line to the left of the gray
                  box._)  Then, either hit the play button (which appears to the left
                  of the blue line), or hit **[Shift] + [Enter]** on your keyboard.


                  If the code runs successfully, three lines of output are
                  returned.  Below, you can see the same code that you just ran, along
                  with the output that you should see in your notebook.
                id: test-uuid-005
                metadata: {}
                sortingKey: "1"
                type: markdown
              - blockGroup: test-uuid-006
                content: >-
                  # This Python 3 environment comes with many helpful analytics
                  libraries installed

                  # It is defined by the kaggle/python docker image:
                  https://github.com/kaggle/docker-python

                  # For example, here's several helpful packages to load in


                  import numpy as np # linear algebra

                  import pandas as pd # data processing, CSV file I/O (e.g.
                  pd.read_csv)


                  # Input data files are available in the "../input/" directory.

                  # For example, running this (by clicking run or pressing
                  Shift+Enter) will list all files under the input directory


                  import os

                  for dirname, _, filenames in os.walk('/kaggle/input'):
                      for filename in filenames:
                          print(os.path.join(dirname, filename))

                  # Any results you write to the current directory are saved as
                  output.
                id: test-uuid-007
                metadata:
                  _kg_hide-input: false
                  execution:
                    iopub.execute_input: 2025-09-01T09:06:57.140357Z
                    iopub.status.busy: 2025-09-01T09:06:57.139933Z
                    iopub.status.idle: 2025-09-01T09:06:57.371877Z
                    shell.execute_reply: 2025-09-01T09:06:57.371054Z
                    shell.execute_reply.started: 2025-09-01T09:06:57.140287Z
                  trusted: true
                outputs: []
                sortingKey: "2"
                type: code
              - blockGroup: test-uuid-008
                content: >-
                  This shows us where the competition data is stored, so that we can
                  load the files into the notebook.  We'll do that next.


                  ## Load the data


                  The second code cell in your notebook now appears below the three
                  lines of output with the file locations.


                  ![](https://i.imgur.com/OQBax9n.png)


                  Type the two lines of code below into your second code cell.  Then,
                  once you're done, either click on the blue play button, or hit
                  **[Shift] + [Enter]**.  
                id: test-uuid-009
                metadata: {}
                sortingKey: "3"
                type: markdown
              - blockGroup: test-uuid-010
                content: |
                  train_data = pd.read_csv("/kaggle/input/titanic/train.csv")
                  train_data.head()
                id: test-uuid-011
                metadata:
                  execution:
                    iopub.execute_input: 2025-09-01T09:06:57.374629Z
                    iopub.status.busy: 2025-09-01T09:06:57.374278Z
                    iopub.status.idle: 2025-09-01T09:06:57.427646Z
                    shell.execute_reply: 2025-09-01T09:06:57.426732Z
                    shell.execute_reply.started: 2025-09-01T09:06:57.374555Z
                  trusted: true
                outputs: []
                sortingKey: "4"
                type: code
              - blockGroup: test-uuid-012
                content: >-
                  Your code should return the output above, which corresponds to the
                  first five rows of the table in **train.csv**.  It's very important
                  that you see this output **in your notebook** before proceeding with
                  the tutorial!

                  > _If your code does not produce this output_, double-check that
                  your code is identical to the two lines above.  And, make sure your
                  cursor is in the code cell before hitting **[Shift] + [Enter]**.


                  The code that you've just written is in the Python programming
                  language. It uses a Python "module" called **pandas** (abbreviated
                  as \`pd\`) to load the table from the **train.csv** file into the
                  notebook. To do this, we needed to plug in the location of the file
                  (which we saw was \`/kaggle/input/titanic/train.csv\`).  

                  > If you're not already familiar with Python (and pandas), the code
                  shouldn't make sense to you -- but don't worry!  The point of this
                  tutorial is to (quickly!) make your first submission to the
                  competition.  At the end of the tutorial, we suggest resources to
                  continue your learning.


                  At this point, you should have at least three code cells in your
                  notebook.  

                  ![](https://i.imgur.com/ReLhYca.png)


                  Copy the code below into the third code cell of your notebook to
                  load the contents of the **test.csv** file.  Don't forget to click
                  on the play button (or hit **[Shift] + [Enter]**)!
                id: test-uuid-013
                metadata: {}
                sortingKey: "5"
                type: markdown
              - blockGroup: test-uuid-014
                content: |-
                  test_data = pd.read_csv("/kaggle/input/titanic/test.csv")
                  test_data.head()
                id: test-uuid-015
                metadata:
                  execution:
                    iopub.execute_input: 2025-09-01T09:06:57.431176Z
                    iopub.status.busy: 2025-09-01T09:06:57.430967Z
                    iopub.status.idle: 2025-09-01T09:06:57.470048Z
                    shell.execute_reply: 2025-09-01T09:06:57.468935Z
                    shell.execute_reply.started: 2025-09-01T09:06:57.431137Z
                  trusted: true
                outputs: []
                sortingKey: "6"
                type: code
              - blockGroup: test-uuid-016
                content: >-
                  As before, make sure that you see the output above in your notebook
                  before continuing.  


                  Once all of the code runs successfully, all of the data (in
                  **train.csv** and **test.csv**) is loaded in the notebook.  (_The
                  code above shows only the first 5 rows of each table, but all of the
                  data is there -- all 891 rows of **train.csv** and all 418 rows of
                  **test.csv**!_)


                  # Part 3: Your first submission


                  Remember our goal: we want to find patterns in **train.csv** that
                  help us predict whether the passengers in **test.csv** survived.


                  It might initially feel overwhelming to look for patterns, when
                  there's so much data to sort through.  So, we'll start simple.


                  ## Explore a pattern


                  Remember that the sample submission file in
                  **gender_submission.csv** assumes that all female passengers
                  survived (and all male passengers died).  


                  Is this a reasonable first guess?  We'll check if this pattern holds
                  true in the data (in **train.csv**).


                  Copy the code below into a new code cell.  Then, run the cell.
                id: test-uuid-017
                metadata: {}
                sortingKey: "7"
                type: markdown
              - blockGroup: test-uuid-018
                content: |-
                  women = train_data.loc[train_data.Sex == 'female']["Survived"]
                  rate_women = sum(women)/len(women)

                  print("% of women who survived:", rate_women)
                id: test-uuid-019
                metadata:
                  execution:
                    iopub.execute_input: 2025-09-01T09:06:57.473657Z
                    iopub.status.busy: 2025-09-01T09:06:57.473144Z
                    iopub.status.idle: 2025-09-01T09:06:57.484251Z
                    shell.execute_reply: 2025-09-01T09:06:57.483288Z
                    shell.execute_reply.started: 2025-09-01T09:06:57.473544Z
                  scrolled: true
                  trusted: true
                outputs: []
                sortingKey: "8"
                type: code
              - blockGroup: test-uuid-020
                content: >-
                  Before moving on, make sure that your code returns the output
                  above.  The code above calculates the percentage of female
                  passengers (in **train.csv**) who survived.


                  Then, run the code below in another code cell:
                id: test-uuid-021
                metadata: {}
                sortingKey: "9"
                type: markdown
              - blockGroup: test-uuid-022
                content: |-
                  men = train_data.loc[train_data.Sex == 'male']["Survived"]
                  rate_men = sum(men)/len(men)

                  print("% of men who survived:", rate_men)
                id: test-uuid-023
                metadata:
                  execution:
                    iopub.execute_input: 2025-09-01T09:06:57.486507Z
                    iopub.status.busy: 2025-09-01T09:06:57.486162Z
                    iopub.status.idle: 2025-09-01T09:06:57.506208Z
                    shell.execute_reply: 2025-09-01T09:06:57.505447Z
                    shell.execute_reply.started: 2025-09-01T09:06:57.486442Z
                  trusted: true
                outputs: []
                sortingKey: a
                type: code
              - blockGroup: test-uuid-024
                content: >-
                  The code above calculates the percentage of male passengers (in
                  **train.csv**) who survived.


                  From this you can see that almost 75% of the women on board
                  survived, whereas only 19% of the men lived to tell about it. Since
                  gender seems to be such a strong indicator of survival, the
                  submission file in **gender_submission.csv** is not a bad first
                  guess!


                  But at the end of the day, this gender-based submission bases its
                  predictions on only a single column.  As you can imagine, by
                  considering multiple columns, we can discover more complex patterns
                  that can potentially yield better-informed predictions.  Since it is
                  quite difficult to consider several columns at once (or, it would
                  take a long time to consider all possible patterns in many different
                  columns simultaneously), we'll use machine learning to automate this
                  for us.


                  ## Your first machine learning model


                  We'll build what's known as a **random forest model**.  This model
                  is constructed of several "trees" (there are three trees in the
                  picture below, but we'll construct 100!) that will individually
                  consider each passenger's data and vote on whether the individual
                  survived.  Then, the random forest model makes a democratic
                  decision: the outcome with the most votes wins!


                  ![](https://i.imgur.com/AC9Bq63.png)


                  The code cell below looks for patterns in four different columns
                  (**"Pclass"**, **"Sex"**, **"SibSp"**, and **"Parch"**) of the
                  data.  It constructs the trees in the random forest model based on
                  patterns in the **train.csv** file, before generating predictions
                  for the passengers in **test.csv**.  The code also saves these new
                  predictions in a CSV file **submission.csv**.


                  Copy this code into your notebook, and run it in a new code cell.
                id: test-uuid-025
                metadata: {}
                sortingKey: b
                type: markdown
              - blockGroup: test-uuid-026
                content: >-
                  from sklearn.ensemble import RandomForestClassifier


                  y = train_data["Survived"]


                  features = ["Pclass", "Sex", "SibSp", "Parch"]

                  X = pd.get_dummies(train_data[features])

                  X_test = pd.get_dummies(test_data[features])


                  model = RandomForestClassifier(n_estimators=100, max_depth=5,
                  random_state=1)

                  model.fit(X, y)

                  predictions = model.predict(X_test)


                  output = pd.DataFrame({'PassengerId': test_data.PassengerId,
                  'Survived': predictions})

                  output.to_csv('submission.csv', index=False)

                  print("Your submission was successfully saved!")
                id: test-uuid-027
                metadata:
                  _kg_hide-output: false
                  execution:
                    iopub.execute_input: 2025-09-01T09:06:57.507870Z
                    iopub.status.busy: 2025-09-01T09:06:57.507569Z
                    iopub.status.idle: 2025-09-01T09:07:00.901413Z
                    shell.execute_reply: 2025-09-01T09:07:00.900466Z
                    shell.execute_reply.started: 2025-09-01T09:06:57.507805Z
                  trusted: true
                outputs: []
                sortingKey: c
                type: code
              - blockGroup: test-uuid-028
                content: >-
                  Make sure that your notebook outputs the same message above (\`Your
                  submission was successfully saved!\`) before moving on.

                  > Again, don't worry if this code doesn't make sense to you!  For
                  now, we'll focus on how to generate and submit predictions.


                  Once you're ready, click on the **"Save Version"** button in the top
                  right corner of your notebook.  This will generate a pop-up
                  window.  

                  - Ensure that the **"Save and Run All"** option is selected, and
                  then click on the **"Save"** button.

                  - This generates a window in the bottom left corner of the
                  notebook.  After it has finished running, click on the number to the
                  right of the **"Save Version"** button.  This pulls up a list of
                  versions on the right of the screen.  Click on the ellipsis
                  **(...)** to the right of the most recent version, and select **Open
                  in Viewer**.  

                  - Click on the **Data** tab on the top of the screen.  Then, click
                  on the **"Submit"** button to submit your results.


                  ![](https://i.imgur.com/1ocaUl4.png)


                  Congratulations for making your first submission to a Kaggle
                  competition!  Within ten minutes, you should receive a message
                  providing your spot on the leaderboard.  Great work!
                id: test-uuid-029
                metadata: {}
                sortingKey: d
                type: markdown
              - blockGroup: test-uuid-030
                content: >-
                  # Part 4: Learn more!


                  If you're interested in learning more, we strongly suggest our
                  (3-hour) **[Intro to Machine
                  Learning](https://www.kaggle.com/learn/intro-to-machine-learning)**
                  course, which will help you fully understand all of the code that
                  we've presented here.  You'll also know enough to generate even
                  better predictions!
                id: test-uuid-031
                metadata: {}
                sortingKey: e
                type: markdown
            executionMode: block
            id: test-uuid-032
            isModule: false
            name: titanic-tutorial
        settings: {}
      version: 1.0.0
      "
    `)
  })

  it('matches snapshot for multiple notebooks', async () => {
    const inputPaths = [
      path.join(__dirname, '__fixtures__', 'notebook1.ipynb'),
      path.join(__dirname, '__fixtures__', 'notebook2.ipynb'),
    ]
    const outputPath = path.join(tempDir, 'multi.deepnote')

    await convertIpynbFilesToDeepnoteFile(inputPaths, {
      outputPath,
      projectName: 'Multi Notebook',
    })

    const content = await fs.readFile(outputPath, 'utf-8')
    expect(content).toMatchInlineSnapshot(`
      "metadata:
        createdAt: 2024-01-15T10:30:00.000Z
      project:
        id: test-uuid-001
        integrations: []
        name: Multi Notebook
        notebooks:
          - blocks:
              - blockGroup: test-uuid-002
                content: "# Notebook 1"
                id: test-uuid-003
                metadata: {}
                sortingKey: "0"
                type: markdown
              - blockGroup: test-uuid-004
                content: x = 1
                executionCount: 1
                id: test-uuid-005
                metadata: {}
                outputs: []
                sortingKey: "1"
                type: code
            executionMode: block
            id: test-uuid-006
            isModule: false
            name: notebook1
          - blocks:
              - blockGroup: test-uuid-007
                content: "# Notebook 2"
                id: test-uuid-008
                metadata: {}
                sortingKey: "0"
                type: markdown
              - blockGroup: test-uuid-009
                content: y = 2
                executionCount: 1
                id: test-uuid-010
                metadata: {}
                outputs: []
                sortingKey: "1"
                type: code
            executionMode: block
            id: test-uuid-011
            isModule: false
            name: notebook2
        settings: {}
      version: 1.0.0
      "
    `)
  })
})

describe('convertJupyterNotebookToBlocks', () => {
  beforeEach(() => {
    const mockedV4 = getMockedUuidV4()
    mockedV4.mockClear()
    mockedV4.__resetCounter()
  })

  it('converts a Jupyter notebook to blocks', () => {
    const notebook = {
      cells: [
        {
          cell_type: 'markdown' as const,
          metadata: {},
          source: '# Hello',
        },
        {
          cell_type: 'code' as const,
          execution_count: 1,
          metadata: {},
          outputs: [{ output_type: 'stream', name: 'stdout', text: ['hi\n'] }],
          source: "print('hi')",
        },
      ],
      metadata: {},
    }

    const blocks = convertJupyterNotebookToBlocks(notebook)

    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('markdown')
    expect(blocks[0].content).toBe('# Hello')
    expect(blocks[1].type).toBe('code')
    expect(blocks[1].content).toBe("print('hi')")
    expect(blocks[1].executionCount).toBe(1)
    expect(blocks[1].outputs).toEqual([{ output_type: 'stream', name: 'stdout', text: ['hi\n'] }])
  })

  it('uses custom idGenerator when provided', () => {
    let counter = 0
    const customIdGenerator = () => `custom-id-${++counter}`

    const notebook = {
      cells: [
        {
          cell_type: 'code' as const,
          metadata: {},
          outputs: [],
          source: 'x = 1',
        },
        {
          cell_type: 'code' as const,
          metadata: {},
          outputs: [],
          source: 'y = 2',
        },
      ],
      metadata: {},
    }

    const blocks = convertJupyterNotebookToBlocks(notebook, {
      idGenerator: customIdGenerator,
    })

    expect(blocks).toHaveLength(2)
    // Each block uses 2 IDs: one for blockGroup and one for id
    expect(blocks[0].blockGroup).toBe('custom-id-1')
    expect(blocks[0].id).toBe('custom-id-2')
    expect(blocks[1].blockGroup).toBe('custom-id-3')
    expect(blocks[1].id).toBe('custom-id-4')
  })

  it('uses default uuid v4 when no idGenerator provided', () => {
    const notebook = {
      cells: [
        {
          cell_type: 'code' as const,
          metadata: {},
          outputs: [],
          source: 'x = 1',
        },
      ],
      metadata: {},
    }

    const blocks = convertJupyterNotebookToBlocks(notebook)

    expect(blocks).toHaveLength(1)
    // Should use the mocked uuid which generates test-uuid-XXX
    expect(blocks[0].blockGroup).toBe('test-uuid-001')
    expect(blocks[0].id).toBe('test-uuid-002')
  })

  it('preserves Deepnote metadata from previous conversion', () => {
    const notebook = {
      cells: [
        {
          cell_type: 'code' as const,
          metadata: {
            cell_id: 'original-cell-id',
            deepnote_cell_type: 'sql',
            deepnote_block_group: 'original-block-group',
            deepnote_sorting_key: 'abc',
            deepnote_source: 'SELECT * FROM table',
          },
          outputs: [],
          source: 'transformed code that should be ignored',
        },
      ],
      metadata: {},
    }

    const blocks = convertJupyterNotebookToBlocks(notebook)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].id).toBe('original-cell-id')
    expect(blocks[0].blockGroup).toBe('original-block-group')
    expect(blocks[0].sortingKey).toBe('abc')
    expect(blocks[0].type).toBe('sql')
    // Should restore original content from deepnote_source
    expect(blocks[0].content).toBe('SELECT * FROM table')
  })

  it('handles array source format', () => {
    const notebook = {
      cells: [
        {
          cell_type: 'code' as const,
          metadata: {},
          outputs: [],
          source: ['import numpy as np\n', 'import pandas as pd'],
        },
      ],
      metadata: {},
    }

    const blocks = convertJupyterNotebookToBlocks(notebook)

    expect(blocks[0].content).toBe('import numpy as np\nimport pandas as pd')
  })
})
