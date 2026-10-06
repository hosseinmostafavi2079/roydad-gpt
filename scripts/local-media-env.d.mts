export function developmentMediaRoot(workspace: string): string;
export function prepareDevelopmentMediaRoot(workspace: string): string;
export function localMediaEnvironment(
  workspace: string,
  driver?: string,
  docker?: boolean,
): { MEDIA_STORAGE_DRIVER: string; MEDIA_LOCAL_ROOT: string };
