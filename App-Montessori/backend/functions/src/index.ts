import { onCall } from 'firebase-functions/v2/https';
import { REGION } from './core/firebase';
import { createRouter, ApiRequest } from './core/router';
import { actions } from './modules';

const handle = createRouter(actions);

/** Cloud Function callable duy nhất cho web + mobile. Xem docs/CONTRACT.md §4. */
export const api = onCall<ApiRequest>(
  { region: REGION, cors: true, memory: '512MiB', timeoutSeconds: 120, maxInstances: 50 },
  (req) => handle(req),
);

export * from './triggers';
