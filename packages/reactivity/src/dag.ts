import type { DeepnoteBlock } from '@deepnote/blocks'
import { type BlockContentDepsWithOrder, getBlockDependencies } from './ast-analyzer'
import { getDownstreamBlocksForBlocksIds, getUpstreamBlocksForBlocksIds } from './dag-analyzer'
import { buildDagFromBlocks } from './dag-builder'

export class DagError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DagError'
  }
}

export type DownstreamBlocksStatus = 'success' | 'missing-deps' | 'fatal'
export type UpstreamBlocksStatus = 'success' | 'missing-deps' | 'fatal'

export interface GetBlocksWithDepsSuccessResult {
  status: 'success' | 'missing-deps'
  blocksToExecuteWithDeps: DeepnoteBlock[]
  newlyComputedBlocksContentDeps: BlockContentDepsWithOrder[]
}

export type GetUpstreamBlocksResult =
  | GetBlocksWithDepsSuccessResult
  | {
      status: 'fatal'
      error: DagError | SyntaxError
    }

export type GetDownstreamBlocksResult =
  | GetBlocksWithDepsSuccessResult
  | {
      status: 'fatal'
      error: DagError | SyntaxError
    }

export async function getDagForBlocks(
  blocks: DeepnoteBlock[],
  options: {
    // If true, the function will not throw an error and return partial DAG
    // this may happen when there is an error in one of the processed blocks.
    // Partial DAG should be used only in the DAG chart.
    acceptPartialDAG: boolean
    pythonInterpreter?: string
  } = { acceptPartialDAG: false }
) {
  try {
    const blocksWithContentDeps = await getBlockDependencies(blocks, {
      pythonInterpreter: options.pythonInterpreter,
    })

    const blocksWithErrorInContentDeps = blocksWithContentDeps.filter(block => block.error)
    const blocksWithoutErrorsInContentDeps = blocksWithContentDeps.filter(block => !block.error)

    if (blocksWithErrorInContentDeps.length > 0 && !options.acceptPartialDAG) {
      const firstErrorBlock = blocksWithErrorInContentDeps[0]
      if (firstErrorBlock?.error?.type === 'SyntaxError') {
        throw new SyntaxError(firstErrorBlock.error.message)
      }
    }

    const allBlocksForDAG = options.acceptPartialDAG ? blocksWithContentDeps : blocksWithoutErrorsInContentDeps
    const dag = buildDagFromBlocks(allBlocksForDAG)
    return { dag, blocksWithErrorInContentDeps, newlyComputedBlocksContentDeps: blocksWithContentDeps }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw error
    }

    throw new DagError(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Takes blocks, creates DAG and returns blocks that should be executed based in blocksToExecute for downstream execution.
 * @param blocks All blocks in the notebook
 * @param blocksToExecute Blocks that triggered the downstream execution
 * @param options Options for DAG generation
 */
export async function getDownstreamBlocks(
  blocks: DeepnoteBlock[],
  blocksToExecute: DeepnoteBlock[],
  options: { pythonInterpreter?: string } = {}
): Promise<GetDownstreamBlocksResult> {
  try {
    const { dag, blocksWithErrorInContentDeps, newlyComputedBlocksContentDeps } = await getDagForBlocks(blocks, {
      acceptPartialDAG: true,
      pythonInterpreter: options.pythonInterpreter,
    })
    const downstreamBlocks = getDownstreamBlocksForBlocksIds(
      dag,
      blocksToExecute.map(cell => cell.id)
    )
    // Merge the blocks we want to execute (input blocks) with the blocks that depend on them
    const blocksToExecuteWithDeps = blocks.filter(
      block => blocksToExecute.find(b => b.id === block.id) || downstreamBlocks.includes(block.id)
    )

    const status = blocksWithErrorInContentDeps.length === 0 ? 'success' : 'missing-deps'

    return { status, blocksToExecuteWithDeps, newlyComputedBlocksContentDeps }
  } catch (error) {
    if (error instanceof DagError || error instanceof SyntaxError) {
      return { status: 'fatal', error }
    }

    return { status: 'fatal', error: new DagError(error instanceof Error ? error.message : String(error)) }
  }
}

/**
 * Takes blocks, creates DAG and returns blocks that should be executed based in blocksToExecute for upstream execution.
 * @param blocks All blocks in the notebook
 * @param blocksToExecute Blocks that triggered the upstream execution
 * @param options Options for DAG generation
 */
export async function getUpstreamBlocks(
  blocks: DeepnoteBlock[],
  blocksToExecute: DeepnoteBlock[],
  options: { pythonInterpreter?: string } = {}
): Promise<GetUpstreamBlocksResult> {
  try {
    const { dag, blocksWithErrorInContentDeps, newlyComputedBlocksContentDeps } = await getDagForBlocks(blocks, {
      acceptPartialDAG: true,
      pythonInterpreter: options.pythonInterpreter,
    })
    const upstreamBlocks = getUpstreamBlocksForBlocksIds(
      dag,
      blocksToExecute.map(cell => cell.id)
    )
    // Merge the blocks we want to execute with the blocks they depend on.
    const blocksToExecuteWithDeps = blocks.filter(
      block => blocksToExecute.find(b => b.id === block.id) || upstreamBlocks.includes(block.id)
    )

    const status = blocksWithErrorInContentDeps.length === 0 ? 'success' : 'missing-deps'

    return { status, blocksToExecuteWithDeps, newlyComputedBlocksContentDeps }
  } catch (error) {
    if (error instanceof DagError || error instanceof SyntaxError) {
      return { status: 'fatal', error }
    }

    return { status: 'fatal', error: new DagError(error instanceof Error ? error.message : String(error)) }
  }
}
