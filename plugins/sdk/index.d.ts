export interface Manifest {
  protocol: 1;
  id: string;
  name: string;
  version: string;
  appIds: string[];
  capabilities?: ('thumbnails')[];
  description?: string;
  homepage?: string;
}
export type Presentation = 'text' | 'thumbnails';
export interface Item { id: string; title: string; subtitle?: string; description?: string; active?: boolean; icon?: string; preview?: boolean }
export interface Context { id: string; focused: boolean; presentation?: Presentation; items: Item[] }
export interface RequestContext { instance: string; signal: AbortSignal }
export interface Target { context: string; item: string }
export interface ThumbnailRequest { context: string; items: {id: string; url: string}[] }
export interface ThumbnailReply { context: string; items: {id: string; url: string; image: string}[] }
export function startPlugin(options: {
  manifest: Manifest;
  directory?: string;
  list(context: RequestContext): Promise<{contexts: Context[]}> | {contexts: Context[]};
  activate(target: Target, context: RequestContext): Promise<Target & {verified: true}> | (Target & {verified: true});
  thumbnails?(request: ThumbnailRequest, context: RequestContext): Promise<ThumbnailReply> | ThumbnailReply;
  onError?(error: Error): void;
}): Promise<{instance: string; manifest: Manifest; dispose(): Promise<void>}>;
export function validateManifest(value: unknown): Manifest;
export function registerManifest(value: Manifest, options?: {directory?: string}): Promise<Manifest>;
export function directory(): string;
export const MAX_MESSAGE: number;
