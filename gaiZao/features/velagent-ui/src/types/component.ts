/** 画布元件（精简版只保留类型占位）。 */
export type Component = {
  id: string;
  metadataId: string;
  x: number;
  y: number;
  properties: Record<string, unknown>;
  rotation?: number;
};
