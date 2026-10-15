import { renderEquation } from './render';

self.onmessage = (event: MessageEvent<{ id: number; source: string; display: boolean }>) => {
  const { id, source, display } = event.data;
  try {
    self.postMessage({ id, result: renderEquation(source, display) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Check the equation syntax.' });
  }
};
