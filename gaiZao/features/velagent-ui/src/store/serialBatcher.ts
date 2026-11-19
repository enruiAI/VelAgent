/** 串口批量聚合（精简版：直接透传）。 */
export function createSerialBatcher(onFlush: (perBoard: Map<string, string>) => void) {
  return {
    append: (boardId: string, chunk: string) => onFlush(new Map([[boardId, chunk]])),
    flush: () => undefined,
    dispose: () => undefined,
  };
}
