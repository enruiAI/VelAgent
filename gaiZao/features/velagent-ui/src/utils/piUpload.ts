/** 树莓派文件上传（精简版：无 QEMU 客户机，空实现）。 */
export async function uploadFilesToPi(
  _bridge: unknown,
  _files: Array<{ path: string; content: string }>,
): Promise<void> {
  /* no-op */
}
