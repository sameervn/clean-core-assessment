export function sample(): Buffer;
export function validate(bytes: Buffer): Promise<Buffer>;
export function inspectArchive(bytes: Buffer): Promise<Map<string, Buffer>>;
export function render(bytes: Buffer, data: unknown): Buffer;
export function run(input: { bytes?: string; mode: string; entities?: any[] }): Promise<Buffer>;
