/**
 * serialWire —— 串口"线缆"显示/回传辅助。上游这里连接板卡仿真器与串口监视器；
 * 精简版没有仿真器和串口监视器，保留类型与恒等实现，让 store 继续编译。
 */
export interface SerialLink {
  boardId: string;
  baud: number;
}

/** 显示方向：原样返回串口字符。 */
export function applySerialWireDisplay(_boardId: string, chunk: string): string {
  return chunk;
}

/** 传输方向：原样返回写入的字节。 */
export function applySerialWireTransmit(_boardId: string, bytes: Uint8Array): Uint8Array {
  return bytes;
}

export function nominalBaud(): number {
  return 9600;
}
