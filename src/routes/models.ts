import type { FastifyInstance } from 'fastify';
import type { ExposedModel } from '../workbuddy/model-catalog.js';

interface ModelsOpts {
  models: ExposedModel[];
}

export function modelsRoutes(app: FastifyInstance, opts: ModelsOpts): void {
  app.get('/models', async () => ({
    object: 'list',
    data: opts.models,
  }));

  app.get<{ Params: { id: string } }>('/models/:id', async (req, reply) => {
    const found = opts.models.find((m) => m.id === req.params.id);
    if (!found) {
      return reply
        .code(404)
        .send({ error: { message: `Model '${req.params.id}' not found.`, type: 'invalid_request_error', param: 'model', code: 'model_not_found' } });
    }
    return found;
  });
}
